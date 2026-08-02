/**
 * In-app debug session controller: wires together the LDK session core
 * ({@link startRemoteDebugSession}), the CDP client ({@link InspectorClient})
 * and the source-map bridge ({@link loadMapBridge}) into a single
 * breakpoint-level debug run against a deployed workflow, surfacing
 * everything through a plain event interface instead of a DAP client.
 *
 * Sequencing — verified against a real Lambda end-to-end, not guessed:
 *
 * 1. Fire `handle.invoke()` WITHOUT awaiting it. The sandbox (and therefore
 *    the inspector behind the tunnel) only exists once an invoke starts;
 *    the LDK wrapper then holds the runtime at a 'Break on start' pause.
 * 2. `InspectorClient.connect(handle.port)` — a poll loop, because the
 *    tunnel's local port hangs until the Lambda-side peer appears.
 * 3. `enable()`, set breakpoints (they bind late — the bundle isn't parsed
 *    yet at break-on-start, which is fine, see inspectorClient.ts), then
 *    `runIfWaitingForDebugger()` to release the held runtime.
 * 4. Pauses arrive as a stream. The wrapper's break-on-start (and any other
 *    pause that doesn't hit OUR breakpoints and doesn't map to the user's
 *    `.dar.ts` source) is auto-resumed — bounded, so a pathological pause
 *    storm can't spin forever. Breakpoint pauses are surfaced with
 *    locations translated to `.dar.ts` lines via the map bridge.
 * 5. When the sandbox's inspector connection drops but the invoke has NOT
 *    settled, the durable execution merely SUSPENDED (see below) — go back
 *    to step 2 and re-attach to the next invocation's sandbox.
 * 6. When the un-awaited invoke finally settles, the run is over: emit
 *    `onDone`/`onError` and tear everything down (client, bridge, and the
 *    core handle — which reverts the function config and closes the tunnel).
 *
 * ONE RUN, MANY SANDBOXES — the durable replay model. A durable execution is
 * not one invocation. Every time the workflow suspends (`wait`,
 * `waitForCallback`, a `waitForCondition` poll interval) the current
 * invocation ENDS, its sandbox goes away — taking the inspector, and every
 * CDP breakpoint id with it — and the execution RESUMES LATER in a brand new
 * invocation with a brand new sandbox, held at its own 'Break on start'. A
 * single-attach debugger therefore goes silently deaf at the first `wait`,
 * and a breakpoint on any node AFTER that wait would never be hit. So the
 * attach phase is a LOOP keyed on {@link InspectorClient.onClosed}, and the
 * breakpoint set the UI asked for is kept in `desiredDarLines` and
 * re-installed on every new sandbox.
 *
 * The loop only reaches so far: Lambda ends a debug session after 60 seconds of
 * sandbox freeze, so re-attach recovers short suspensions and nothing longer —
 * see {@link FREEZE_LIMIT_MS }.
 *
 * A consequence worth knowing when reading pause behavior: on a replay, a
 * node's OPERATION line (`await ctx.wait(...)`, `await ctx.step(...)`) runs
 * again on every invocation, so a NODE-ENTRY breakpoint hits repeatedly —
 * whereas an already-checkpointed step's BODY does not re-execute, so a
 * breakpoint on a body statement only hits the once.
 *
 * NO `vscode` imports (same rule as every sibling in `remoteDebug/`): this
 * runs in the extension host, plain Node, and the Electron main process.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  startRemoteDebugSession,
  type RemoteDebugHandle,
  type StartRemoteDebugSessionOptions,
} from "./debugSessionCore";
import { InspectorClient, type PausedEvent } from "./inspectorClient";
import { loadMapBridge } from "./mapBridge";

/** `Debugger.setBreakpointByUrl` regex matching the deployed bundle. The
 * sandbox reports the script as `file:///var/task/index.js`. */
const BUNDLE_URL_REGEX = ".*/var/task/index\\.js";
/** Substring test for "is this call frame inside the deployed bundle?". */
const BUNDLE_URL_SUBSTRING = "/var/task/index.js";
/** Auto-resume bound: this many CONSECUTIVE pauses that match nothing of
 * ours means something is wrong (e.g. an exception loop in runtime code) —
 * stop the session instead of spinning on resume forever. */
const MAX_CONSECUTIVE_AUTO_RESUMES = 50;
/**
 * Lambda ends a debug session once the sandbox has been FROZEN for 60 seconds
 * (confirmed with the Lambda team in DAR-431). A durable execution freezes its
 * sandbox for the whole of every suspension, so:
 *
 * - suspensions shorter than 60s resume onto the same warm sandbox and the
 *   debugger carries on (that is what the re-attach loop is for), while
 * - a single suspension longer than 60s — `wait({ minutes: 5 })`, a callback a
 *   human has to action, a long condition-poll interval, a long retry backoff —
 *   kills the debug session outright. The execution itself continues; only the
 *   debugger is gone, and no later sandbox will carry it.
 *
 * So a re-attach poll is pointless past the freeze limit: this is that limit
 * plus enough margin for the resuming invocation to start and its tunnel
 * destination to connect. An EARLIER version waited the session's full 900s,
 * which just hung the UI for 15 minutes on any workflow with a long wait.
 */
const FREEZE_LIMIT_MS = 60_000;
const REATTACH_DISCOVERY_TIMEOUT_MS = FREEZE_LIMIT_MS + 15_000;

/** Thrown to abort an inspector-discovery poll because the durable execution
 * settled: no further sandbox can appear. Whether that is an error depends on
 * WHEN it happens — see `attachOnce`. */
class RunEndedError extends Error {}

/** One frame of a surfaced pause, in user (`.dar.ts`) coordinates where
 * possible. `darLine` is null for frames outside the user's workflow
 * source (SDK/runtime code). Lines are 1-based. */
export interface DebugCallStackFrame {
  functionName: string;
  darLine: number | null;
  bundleLine: number;
}

export interface DebugRunnerEvents {
  /** Human-readable progress (setup phases, attach, teardown). */
  onStatus(message: string): void;
  /** A pause the user should see (breakpoint hit, step landing, ...). */
  onPaused(p: {
    darLine: number | null;
    bundleLine: number;
    functionName?: string;
    callStack: DebugCallStackFrame[];
    scopes: Array<{ type: string; objectId?: string }>;
  }): void;
  /** Execution resumed after a surfaced pause. */
  onResumed(): void;
  /** The invoke settled successfully — the run is over (teardown follows). */
  onDone(result: {
    statusCode?: number;
    payload: string;
    logTail?: string;
  }): void;
  /** The run failed (invoke rejection, pause-storm bound, internal error). */
  onError(message: string): void;
}

export interface DebugRunnerHandle {
  /**
   * Retranslates and REPLACES all breakpoints (stale ones are removed
   * first). Returns the 1-based `.dar.ts` lines that actually bound — a
   * line that maps to no generated code (blank/comment lines) is dropped.
   */
  setBreakpoints(darLines: number[]): Promise<number[]>;
  /** Resume from a surfaced pause. Rejects when not paused. */
  continue_(): Promise<void>;
  stepOver(): Promise<void>;
  stepInto(): Promise<void>;
  stepOut(): Promise<void>;
  /** Own properties of a paused frame's scope object — same shape as
   * {@link InspectorClient.getProperties}. */
  getProperties(objectId: string): ReturnType<InspectorClient["getProperties"]>;
  /** Full teardown: inspector client, map bridge, and the core session
   * handle (config revert + tunnel close). Idempotent; never throws. */
  stop(): Promise<void>;
}

export interface StartDebugRunOptions {
  region: string;
  credentials: StartRemoteDebugSessionOptions["credentials"];
  functionName: string;
  payloadJson: string;
  /** Durable execution idempotency name (optional) — passed to invoke. */
  executionName?: string;
  /** The debug deploy's out-dir; must contain `index.js.map`. */
  debugOutDir: string;
  /** 1-based `.dar.ts` lines to set before releasing the runtime. */
  initialBreakpointDarLines: number[];
  events: DebugRunnerEvents;
}

const errMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/**
 * Starts one complete debug run: session setup, un-awaited invoke, inspector
 * attach, initial breakpoints, runtime release. Resolves with a live handle
 * once the runtime has been released; every failure path (before OR after
 * that point) ends in a full {@link DebugRunnerHandle.stop | stop()}.
 */
export async function startDebugRun(
  opts: StartDebugRunOptions,
): Promise<DebugRunnerHandle> {
  const { events } = opts;

  // Fail fast BEFORE any AWS mutation: without the map there is nothing to
  // translate breakpoints or pause locations against, so a session would
  // only churn the function's config for an unusable run.
  const mapPath = join(opts.debugOutDir, "index.js.map");
  if (!existsSync(mapPath)) {
    throw new Error(
      `No source map found at ${mapPath} — deploy the function with debug output (which writes index.js.map) before starting a debug run.`,
    );
  }
  const bridge = await loadMapBridge(mapPath);

  let core: RemoteDebugHandle | undefined;
  /** CDP client of the CURRENT sandbox. Replaced on every re-attach — CDP
   * ids (breakpoints, objects, frames) are scoped to one connection. */
  let client: InspectorClient | undefined;
  let stopped = false;
  /** Set once the un-awaited invoke settles: the durable execution is over,
   * so no further sandbox will appear and the attach loop must not wait for
   * one. */
  let invokeSettled = false;
  /** The breakpoint set the UI last asked for, in 1-based `.dar.ts` lines.
   * Kept across attaches: CDP breakpoint ids die with their sandbox, so
   * every re-attach re-installs THIS set (see {@link applyBreakpointsTo}). */
  let desiredDarLines = [...opts.initialBreakpointDarLines];
  /** Live breakpoints of the current sandbox: CDP id → the `.dar.ts` line it
   * serves. Matched against `hitBreakpoints` on every pause; cleared per
   * attach. */
  const breakpointToDar = new Map<string, number>();
  /** True between a SURFACED pause and the following resume — the only
   * window in which stepping/continuing makes sense. Spans attaches (a
   * dropped sandbox resets it), hence outer scope. */
  let isPaused = false;
  /** How many sandboxes this run has attached to. >1 means the execution
   * suspended and resumed at least once. */
  let attachCount = 0;

  /** Idempotent, never-throwing full teardown — the single exit path for
   * completion, failure, and user-initiated stop alike. */
  const stop = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;
    try {
      client?.dispose();
    } catch {
      /* best-effort */
    }
    try {
      bridge.dispose();
    } catch {
      /* best-effort */
    }
    try {
      // Deleting the published debug version is only safe once the execution
      // is over: a durable execution PINS its version, so removing it while
      // the execution can still resume would break the execution itself.
      // `invokeSettled` is exactly that signal — the invoke returned, so no
      // further invocation of this execution is coming.
      await core?.dispose({ deleteVersion: invokeSettled });
    } catch {
      /* best-effort */
    }
  };

  try {
    core = await startRemoteDebugSession({
      region: opts.region,
      credentials: opts.credentials,
      functionName: opts.functionName,
      onProgress: (msg) => events.onStatus(msg),
    });

    // ---- (1) Fire the invoke WITHOUT awaiting: the sandbox + inspector ----
    // only come into existence once an invoke starts, and the call then
    // blocks for the whole DURABLE EXECUTION — which may span several
    // invocations (see the attach loop below).
    events.onStatus("Invoking function (debugger will attach)…");
    const settled = core.invoke(opts.payloadJson, opts.executionName).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    // Flag it the instant it settles, ahead of any other handler: teardown
    // consults this to decide whether deleting the debug version is safe, and
    // teardown can run from a failure path registered before the reporting
    // handler below.
    void settled.then(() => {
      invokeSettled = true;
    });

    // Rejects (with the sentinel) the moment the invoke settles. Raced against
    // every inspector discovery poll: once the execution is over, no further
    // sandbox will ever appear, so a poll waiting for one must be cut short
    // instead of burning its whole deadline.
    const runOver = settled.then((s): never => {
      throw new RunEndedError(
        s.ok
          ? "The durable execution completed."
          : `The invocation failed: ${errMessage(s.error)}`,
      );
    });
    // runOver ALWAYS eventually rejects (that's its job) — it must never
    // surface as an unhandled rejection once a race has been decided.
    runOver.catch(() => {});

    // ---- (2) Breakpoints: .dar.ts lines → bundle lines. ------------------

    /** The `.dar.ts` lines of `darLines` that CAN bind — i.e. that the map
     * says produced generated code. Used to answer the UI even while no
     * sandbox is attached. */
    const bindableDarLines = (darLines: number[]): number[] =>
      [...new Set(darLines)]
        .sort((a, b) => a - b)
        .filter((l) => bridge.darLineToBundleLines(l).length > 0);

    /** Installs `darLines` on `c`, REPLACING whatever it currently has (the
     * UI always sends its full gutter state). Returns the `.dar.ts` lines
     * that actually bound. */
    const applyBreakpointsTo = async (
      c: InspectorClient,
      darLines: number[],
    ): Promise<number[]> => {
      const stale = [...breakpointToDar.keys()];
      breakpointToDar.clear();
      for (const id of stale) {
        await c.removeBreakpoint(id);
      }

      const bound: number[] = [];
      /** One CDP breakpoint per unique bundle line — two .dar.ts lines can
       * map onto the same generated line after bundling. */
      const setBundleLines = new Set<number>();
      for (const darLine of [...new Set(darLines)].sort((a, b) => a - b)) {
        const bundleLines = bridge.darLineToBundleLines(darLine);
        if (bundleLines.length === 0) {
          continue; // No generated code for this line — it cannot bind.
        }
        for (const bundleLine of bundleLines) {
          if (setBundleLines.has(bundleLine)) {
            continue;
          }
          setBundleLines.add(bundleLine);
          // Bridge lines are 1-based; CDP is 0-based.
          const { breakpointId } = await c.setBreakpointByUrl(
            BUNDLE_URL_REGEX,
            bundleLine - 1,
          );
          breakpointToDar.set(breakpointId, darLine);
        }
        bound.push(darLine);
      }
      return bound;
    };

    // ---- (3) Pause handling. ---------------------------------------------

    const frameInfo = (
      f: PausedEvent["callFrames"][number],
    ): DebugCallStackFrame => {
      const bundleLine = f.location.lineNumber + 1; // CDP 0-based → 1-based
      const inBundle = (f.url ?? "").includes(BUNDLE_URL_SUBSTRING);
      return {
        functionName: f.functionName,
        darLine: inBundle ? bridge.bundleLineToDarLine(bundleLine) : null,
        bundleLine,
      };
    };

    // ---- (4) Attach — once per sandbox, repeatedly. ----------------------

    /**
     * Attaches to the sandbox inspector currently behind the tunnel: connect,
     * enable, install {@link desiredDarLines}, release the held runtime.
     *
     * Called once per sandbox. Each attach gets its OWN break-on-start
     * bookkeeping and auto-resume budget (a new sandbox is held at
     * 'Break on start' exactly like the first one), while the breakpoint SET
     * and pause state live in the enclosing run.
     *
     * Returns false when the durable execution ended before a sandbox
     * appeared — for a re-attach that's the normal way a run finishes, so
     * only `isFirst` treats it as an error.
     */
    const attachOnce = async (isFirst: boolean): Promise<boolean> => {
      events.onStatus(
        isFirst
          ? "Waiting for the sandbox inspector…"
          : "Execution resumed in a new invocation — re-attaching the debugger…",
      );
      let c: InspectorClient;
      try {
        c = await Promise.race([
          InspectorClient.connect(core!.port, {
            // A re-attach waits out whatever the workflow is waiting for
            // (a `wait`, a callback, a poll interval), bounded in practice
            // by the session's own function timeout — and cut short by
            // `runOver` the instant the execution finishes.
            discoveryTimeoutMs: isFirst
              ? undefined
              : REATTACH_DISCOVERY_TIMEOUT_MS,
          }),
          runOver,
        ]);
      } catch (e) {
        if (e instanceof RunEndedError) {
          if (isFirst) {
            // Nothing ever paused: a bad payload, or a function that isn't
            // actually instrumented for debugging.
            throw new Error(
              `${e.message} The debugger never got a chance to attach — nothing to debug.`,
            );
          }
          return false; // Normal end of run; the settle handler reports it.
        }
        throw e;
      }
      if (stopped) {
        c.dispose();
        return false;
      }
      client = c;
      attachCount += 1;
      isPaused = false;
      // CDP breakpoint ids belong to the sandbox that issued them — never
      // carry them into a new connection (removing one there would fail).
      breakpointToDar.clear();
      await c.enable();

      /** The first pause after EVERY attach is the LDK wrapper's
       * 'Break on start' — auto-resumed, never surfaced. */
      let sawFirstPause = false;
      let consecutiveAutoResumes = 0;

      const handlePause = async (p: PausedEvent): Promise<void> => {
        if (stopped || client !== c) {
          return; // Stale sandbox — its pauses are no longer meaningful.
        }
        const isFirstPause = !sawFirstPause;
        sawFirstPause = true;

        const frames = p.callFrames.map(frameInfo);
        const top = frames[0];
        // A breakpoint pause arrives with reason 'other' and OUR id in
        // hitBreakpoints (verified against a real Lambda — there is no
        // dedicated "breakpoint" reason). Step landings also come as
        // 'other' WITHOUT hitBreakpoints, hence the second clause: surface
        // any post-startup 'other' pause that maps into the user's source.
        const hitOurs = (p.hitBreakpoints ?? []).some((id) =>
          breakpointToDar.has(id),
        );
        // The .dar.ts line to highlight. Prefer the top frame's reverse-mapped
        // line, but when a KNOWN breakpoint is hit fall back to the line we
        // associated with that breakpoint id at set time. V8 can bind a
        // breakpoint to the next executable bundle line, and reverse-mapping
        // THAT line (originalPositionFor at column 0) sometimes yields null —
        // in which case we'd surface a pause with no line to highlight. The
        // breakpoint→dar association is exact and never null, so it's the
        // reliable source whenever we recognize the hit breakpoint.
        const hitBpDarLine = (p.hitBreakpoints ?? [])
          .map((id) => breakpointToDar.get(id))
          .find((l): l is number => typeof l === "number");
        const surfaced =
          top !== undefined &&
          (hitOurs ||
            (p.reason === "other" && !isFirstPause && top.darLine !== null));

        if (surfaced && top !== undefined) {
          consecutiveAutoResumes = 0;
          isPaused = true;
          const surfacedDarLine = top.darLine ?? hitBpDarLine ?? null;
          events.onPaused({
            darLine: surfacedDarLine,
            bundleLine: top.bundleLine,
            functionName: top.functionName || undefined,
            // Reflect the resolved line on the top frame too, so the call
            // stack and the highlight agree.
            callStack: frames.map((f, i) =>
              i === 0 && f.darLine === null && surfacedDarLine !== null
                ? { ...f, darLine: surfacedDarLine }
                : f,
            ),
            scopes: (p.callFrames[0]?.scopeChain ?? []).map((s) => ({
              type: s.type,
              objectId: s.object.objectId,
            })),
          });
          return;
        }

        // Not ours (break-on-start, runtime-internal pause, unmapped code):
        // resume through it — bounded, so a pause storm can't loop forever.
        consecutiveAutoResumes++;
        if (consecutiveAutoResumes >= MAX_CONSECUTIVE_AUTO_RESUMES) {
          events.onError(
            `Stopping the debug session: ${MAX_CONSECUTIVE_AUTO_RESUMES} consecutive pauses landed outside your breakpoints — the runtime appears stuck outside your code.`,
          );
          await stop();
          return;
        }
        await c.resume();
      };

      // Pause processing is (a) GATED until this attach finishes — the
      // break-on-start event can arrive right after enable(), and it must not
      // be resumed before breakpoints are set — and (b) SERIALIZED through a
      // promise chain, so pauses are handled strictly in arrival order.
      let openGate!: () => void;
      let pauseChain: Promise<void> = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      c.onPaused((p) => {
        pauseChain = pauseChain
          .then(() => handlePause(p))
          .catch(async (e: unknown) => {
            // Rule: every failure path ends in stop().
            if (!stopped) {
              events.onError(
                `Debugger error while handling a pause: ${errMessage(e)}`,
              );
              await stop();
            }
          });
      });
      c.onResumed(() => {
        // Auto-resumes of non-surfaced pauses also emit Debugger.resumed —
        // only report resumes the user actually saw the pause for.
        if (isPaused && client === c) {
          isPaused = false;
          events.onResumed();
        }
      });
      // The sandbox going away is NOT the end of the run for a durable
      // function — see onSandboxGone.
      c.onClosed(() => {
        void onSandboxGone(c);
      });

      // Breakpoints BEFORE releasing the runtime, or they race script startup.
      events.onStatus("Setting breakpoints…");
      await applyBreakpointsTo(c, desiredDarLines);
      await c.runIfWaitingForDebugger();
      openGate();
      events.onStatus(
        isFirst
          ? "Debugger attached — running."
          : `Debugger re-attached (invocation ${attachCount}) — running.`,
      );
      return true;
    };

    /**
     * The current sandbox's inspector connection dropped. For a durable
     * function this is routine, not fatal: whenever the execution suspends
     * (a `wait`, a `waitForCallback`, a `waitForCondition` poll interval) the
     * invocation ENDS and its sandbox goes away, and the execution resumes
     * later in a NEW invocation with a NEW sandbox and a NEW inspector.
     *
     * So unless the whole execution has finished (or the user stopped), wait
     * for the next sandbox and re-attach — re-installing the breakpoint set,
     * which is what lets a breakpoint on a node AFTER a wait ever be hit.
     */
    const onSandboxGone = async (gone: InspectorClient): Promise<void> => {
      if (stopped || client !== gone) {
        return; // Already torn down, or a stale client we've moved past.
      }
      client = undefined;
      breakpointToDar.clear();
      if (isPaused) {
        // Whatever the UI was showing as "paused here" is gone with the
        // sandbox; tell it so the paused decorations don't stick.
        isPaused = false;
        events.onResumed();
      }
      try {
        gone.dispose();
      } catch {
        /* best-effort */
      }
      if (invokeSettled) {
        return; // The run is over; the settle handler reports the outcome.
      }
      events.onStatus(
        "Execution suspended — the invocation ended and its sandbox is gone. Waiting for it to resume (Lambda ends a debug session after 60s of suspension)…",
      );
      try {
        await attachOnce(false);
      } catch (e) {
        if (!stopped) {
          // Overwhelmingly the cause is the freeze limit, so lead with it
          // rather than with a bare discovery timeout the user can't action.
          events.onError(
            `Debugger lost: the execution stayed suspended for longer than Lambda's 60-second debug freeze limit, which ends the debug session. The execution itself keeps running — only debugging stopped. Shorten the wait (or resolve the callback faster) to debug past this point. Details: ${errMessage(e)}`,
          );
          await stop();
        }
      }
    };

    await attachOnce(true);

    // ---- (5) The run ends when the un-awaited invoke settles. ------------
    void settled.then(async (s) => {
      invokeSettled = true;
      if (stopped) {
        return; // User already stopped — the settle is just the fallout.
      }
      if (s.ok) {
        events.onDone(s.result);
      } else {
        events.onError(errMessage(s.error));
      }
      await stop();
    });

    const requireAttached = (action: string): InspectorClient => {
      if (stopped) {
        throw new Error(`Cannot ${action}: the debug session has stopped.`);
      }
      const c = client;
      if (!c) {
        throw new Error(
          `Cannot ${action}: the execution is between invocations (suspended at a wait) — no sandbox is attached.`,
        );
      }
      if (!isPaused) {
        throw new Error(`Cannot ${action}: execution is not paused.`);
      }
      return c;
    };

    return {
      setBreakpoints: async (darLines) => {
        // Remember the request even while detached, so the NEXT sandbox gets
        // it — a user can add breakpoints while the execution is suspended.
        desiredDarLines = [...darLines];
        const c = client;
        return c && !stopped
          ? applyBreakpointsTo(c, desiredDarLines)
          : bindableDarLines(desiredDarLines);
      },
      continue_: async () => {
        await requireAttached("continue").resume();
      },
      stepOver: async () => {
        await requireAttached("step over").stepOver();
      },
      stepInto: async () => {
        await requireAttached("step into").stepInto();
      },
      stepOut: async () => {
        await requireAttached("step out").stepOut();
      },
      getProperties: async (objectId) => {
        const c = client;
        if (!c) {
          throw new Error(
            "Cannot read variables: no sandbox is attached (the execution is between invocations).",
          );
        }
        return c.getProperties(objectId);
      },
      stop,
    };
  } catch (e) {
    // Rule: every failure path ends in stop() (bridge + client + core).
    await stop();
    throw e;
  }
}
