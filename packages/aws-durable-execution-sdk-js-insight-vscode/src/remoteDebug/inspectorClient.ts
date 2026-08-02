/**
 * Minimal Chrome DevTools Protocol (CDP) client for driving the Node
 * inspector inside a remote-debugged Lambda sandbox.
 *
 * Sits directly on top of {@link ../remoteDebug/tunnelProxy!LocalTunnelProxy}'s
 * local port: the tunnel relays raw bytes to the sandbox's inspector, so from
 * here on it looks exactly like a local `node --inspect-brk` process — an
 * HTTP discovery endpoint (`/json/list`) plus a WebSocket that speaks CDP.
 *
 * NO `vscode` imports (same rule as `tunnelProxy.ts` / `debugSessionCore.ts`):
 * this module must run in the extension host, a plain Node child process,
 * and the Electron main process.
 *
 * Behaviors verified end-to-end against a real Lambda (not guesses):
 *
 * - Discovery is `GET http://127.0.0.1:<port>/json/list`, which returns
 *   `[{ webSocketDebuggerUrl, id, ... }]`. The advertised ws URL's host is
 *   the SANDBOX's notion of its address — useless locally — so the host is
 *   rewritten to `127.0.0.1:<port>` before connecting.
 * - When no Lambda-side tunnel peer exists yet, `/json/list` doesn't fail —
 *   it HANGS FOREVER (the tunnel accepts the TCP connection and then has
 *   nowhere to relay it). Every discovery fetch therefore carries an
 *   `AbortSignal.timeout(...)` and the whole thing is a bounded poll loop.
 * - The LDK wrapper pauses the runtime with reason `'Break on start'`
 *   BEFORE the bundle script (`/var/task/index.js`) is parsed. A
 *   `Debugger.setBreakpointByUrl` sent at that point returns EMPTY
 *   `locations` and binds later when the script loads — normal, not an
 *   error, which is why {@link setBreakpointByUrl} doesn't validate them.
 * - Pauses arrive as a STREAM of `Debugger.paused` events (break-on-start,
 *   then each breakpoint hit, each step, ...). They're buffered in a queue
 *   consumed by {@link nextPause} — a single-shot "the pause promise" design
 *   silently drops every pause after the first.
 * - After `Debugger.enable` + breakpoints are set, the held runtime is
 *   released with `Runtime.runIfWaitingForDebugger`.
 * - A breakpoint pause arrives with reason `'other'` and the breakpoint id
 *   in `hitBreakpoints` — NOT some dedicated "breakpoint" reason — so
 *   consumers must match on `hitBreakpoints`, exposed on {@link PausedEvent}.
 */

import WebSocket from "ws";

/** Per-attempt cap on a `/json/list` fetch — see the module doc comment on
 * why the endpoint can hang forever rather than fail. */
const DISCOVERY_FETCH_TIMEOUT_MS = 5_000;
/** Delay between discovery attempts. Short: the Lambda-side peer appears as
 * soon as the wrapper starts the inspector, typically well under a second
 * after the invoke lands. */
const DISCOVERY_RETRY_DELAY_MS = 500;
/** Default overall discovery deadline. Generous (cold start + layer download
 * + tunnel destination connect can stack up on a first invoke). */
const DEFAULT_DISCOVERY_TIMEOUT_MS = 120_000;

/** One CDP call frame of a pause, plus the scope chain needed to walk
 * variables via {@link InspectorClient.getProperties}. */
export interface PausedCallFrame {
  functionName: string;
  location: { scriptId: string; lineNumber: number; columnNumber?: number };
  /** Script URL (e.g. `file:///var/task/index.js`). CDP includes it on the
   * frame itself; when absent it's filled from the scriptId→url map built
   * from `Debugger.scriptParsed` events. */
  url?: string;
  scopeChain: Array<{ type: string; object: { objectId?: string } }>;
}

/** A `Debugger.paused` event, normalized. */
export interface PausedEvent {
  reason?: string;
  /** Set when the pause was caused by a breakpoint (reason is `'other'`
   * then — see module doc comment, verified against a real Lambda). */
  hitBreakpoints?: string[];
  callFrames: PausedCallFrame[];
}

export interface ConnectOptions {
  /** Overall deadline for target discovery (default 120s). */
  discoveryTimeoutMs?: number;
}

/** Shape of one `/json/list` entry (only the fields used here). */
interface InspectorTarget {
  id?: string;
  webSocketDebuggerUrl?: string;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  method: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A connected CDP session. Create via {@link InspectorClient.connect};
 * always {@link dispose} when done (closes the WebSocket and fails any
 * in-flight requests/waiters so callers never hang on a dead session).
 */
export class InspectorClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  /** Buffered pauses not yet consumed by nextPause() — pauses are a STREAM
   * (see module doc comment), so unconsumed ones must queue, not overwrite. */
  private readonly pauseQueue: PausedEvent[] = [];
  /** FIFO of nextPause() callers waiting for a pause that hasn't arrived. */
  private readonly pauseWaiters: Array<{
    resolve: (p: PausedEvent) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  private readonly pausedCallbacks: Array<(p: PausedEvent) => void> = [];
  private readonly resumedCallbacks: Array<() => void> = [];
  /** Fired once when the socket goes away on its own (NOT on dispose) — the
   * sandbox ended. See {@link onClosed}. */
  private readonly closedCallbacks: Array<() => void> = [];
  private notifiedClosed = false;

  /** scriptId → url, built from Debugger.scriptParsed events, so a pause
   * location's scriptId can be attributed to e.g. `/var/task/index.js`
   * even when CDP omits `url` on the call frame. */
  private readonly scriptUrls = new Map<string, string>();

  private disposed = false;

  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => this.handleMessage(data));
    // A dropped ws means every in-flight request and pause waiter would
    // otherwise hang forever — fail them all eagerly instead.
    ws.on("close", () => {
      this.failAll(new Error("Inspector WebSocket closed"));
      this.notifyClosed();
    });
    ws.on("error", (err) => {
      this.failAll(
        err instanceof Error
          ? err
          : new Error(`Inspector WebSocket error: ${err}`),
      );
      this.notifyClosed();
    });
  }

  /**
   * Discovers the inspector target behind `127.0.0.1:<port>` and connects.
   *
   * Poll loop with two nested timeouts: each `/json/list` attempt is
   * aborted after 5s (the endpoint HANGS — never errors — when the
   * Lambda-side peer isn't there yet, see module doc comment), and the
   * loop as a whole gives up after `discoveryTimeoutMs` (default 120s).
   * Empty target lists and fetch failures are both retryable — they just
   * mean the sandbox inspector isn't up yet.
   */
  static async connect(
    port: number,
    opts?: ConnectOptions,
  ): Promise<InspectorClient> {
    const deadline =
      Date.now() + (opts?.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS);
    let lastError = "no inspector target appeared";

    for (;;) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(DISCOVERY_FETCH_TIMEOUT_MS),
        });
        if (res.ok) {
          const targets = (await res.json()) as InspectorTarget[];
          const target = Array.isArray(targets)
            ? targets.find((t) => t.webSocketDebuggerUrl)
            : undefined;
          if (target?.webSocketDebuggerUrl) {
            // The advertised host is the sandbox's own address — rewrite it
            // to the local tunnel port, keeping the path (the target id).
            const wsUrl = new URL(target.webSocketDebuggerUrl);
            wsUrl.host = `127.0.0.1:${port}`;
            return await InspectorClient.connectWebSocket(wsUrl.toString());
          }
          lastError = "inspector /json/list returned no debuggable target";
        } else {
          lastError = `inspector /json/list returned HTTP ${res.status}`;
        }
      } catch (e) {
        lastError = (e as { message?: string })?.message ?? String(e);
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out discovering inspector target on 127.0.0.1:${port}: ${lastError}`,
        );
      }
      await sleep(DISCOVERY_RETRY_DELAY_MS);
    }
  }

  private static connectWebSocket(url: string): Promise<InspectorClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once("open", () => resolve(new InspectorClient(ws)));
      ws.once("error", (err) =>
        reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
  }

  // ------------------------------------------------------------- send ----

  /**
   * Send one CDP request and await its response. Requests are `{id, method,
   * params}`; the matching response arrives as `{id, result}` (resolve) or
   * `{id, error}` (reject) — correlation is by id, so out-of-order responses
   * are fine.
   */
  async send(method: string, params?: object): Promise<unknown> {
    if (this.disposed || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Cannot send ${method}: inspector connection is closed`);
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(
        JSON.stringify({ id, method, params: params ?? {} }),
        (err) => {
          if (err) {
            this.pending.delete(id);
            reject(err);
          }
        },
      );
    });
  }

  // ---------------------------------------------------- typed helpers ----

  /** `Runtime.enable` + `Debugger.enable` — the minimum for scriptParsed
   * events, breakpoints, and pause notifications to flow. */
  async enable(): Promise<void> {
    await this.send("Runtime.enable");
    await this.send("Debugger.enable");
  }

  /**
   * Set a breakpoint by script URL regex. `line0` is CDP's native 0-BASED
   * line number — callers translating from 1-based source lines must
   * subtract one BEFORE calling this. Returned `locations` are deliberately
   * not validated: when the target script hasn't been parsed yet (the
   * break-on-start pause happens before the bundle loads — see module doc
   * comment) they come back empty and the breakpoint binds later.
   */
  async setBreakpointByUrl(
    urlRegex: string,
    line0: number,
  ): Promise<{ breakpointId: string }> {
    const result = (await this.send("Debugger.setBreakpointByUrl", {
      urlRegex,
      lineNumber: line0,
    })) as { breakpointId: string };
    return { breakpointId: result.breakpointId };
  }

  async removeBreakpoint(breakpointId: string): Promise<void> {
    await this.send("Debugger.removeBreakpoint", { breakpointId });
  }

  async resume(): Promise<void> {
    await this.send("Debugger.resume");
  }

  async stepOver(): Promise<void> {
    await this.send("Debugger.stepOver");
  }

  async stepInto(): Promise<void> {
    await this.send("Debugger.stepInto");
  }

  async stepOut(): Promise<void> {
    await this.send("Debugger.stepOut");
  }

  /** Releases a runtime held at the wrapper's break-on-start — send this
   * AFTER enable() + breakpoints, or the breakpoints race script startup. */
  async runIfWaitingForDebugger(): Promise<void> {
    await this.send("Runtime.runIfWaitingForDebugger");
  }

  /**
   * Own properties of a remote object (`Runtime.getProperties` with
   * `ownProperties: true`) — used to walk a paused frame's scope objects.
   * Accessor-only descriptors (getters without a stored value) are omitted:
   * they carry no `value` to display, and invoking getters on a paused
   * remote runtime is a side-effect risk this client doesn't take.
   */
  async getProperties(objectId: string): Promise<
    Array<{
      name: string;
      value: {
        type: string;
        description?: string;
        value?: unknown;
        objectId?: string;
      };
    }>
  > {
    const result = (await this.send("Runtime.getProperties", {
      objectId,
      ownProperties: true,
    })) as {
      result?: Array<{
        name: string;
        value?: {
          type: string;
          description?: string;
          value?: unknown;
          objectId?: string;
        };
      }>;
    };
    return (result.result ?? [])
      .filter(
        (p): p is typeof p & { value: NonNullable<typeof p.value> } =>
          !!p.value,
      )
      .map((p) => ({ name: p.name, value: p.value }));
  }

  // ----------------------------------------------------------- events ----

  /** Register a callback for every `Debugger.paused` event. Callbacks fire
   * in addition to (not instead of) the {@link nextPause} queue. */
  onPaused(cb: (p: PausedEvent) => void): void {
    this.pausedCallbacks.push(cb);
  }

  /** Register a callback for every `Debugger.resumed` event. */
  onResumed(cb: () => void): void {
    this.resumedCallbacks.push(cb);
  }

  /**
   * Register a callback fired ONCE when the connection goes away by itself —
   * the sandbox ended (its invocation finished, or it was reclaimed). NOT
   * fired by {@link dispose}, which is a deliberate local teardown.
   *
   * This is the signal a durable-function debug run needs: a durable
   * execution that suspends (a `wait`, a callback, a long poll) finishes its
   * invocation and RESUMES LATER IN A NEW SANDBOX with a new inspector, so
   * the run has to re-attach rather than assume one connection covers the
   * whole execution. See `debugRunner.ts`'s attach loop.
   */
  onClosed(cb: () => void): void {
    if (this.notifiedClosed) {
      // Already gone — don't strand a late registrant.
      try {
        cb();
      } catch {
        /* callback errors are never the caller's problem here */
      }
      return;
    }
    this.closedCallbacks.push(cb);
  }

  private notifyClosed(): void {
    if (this.notifiedClosed || this.disposed) {
      return;
    }
    this.notifiedClosed = true;
    for (const cb of this.closedCallbacks.splice(0)) {
      try {
        cb();
      } catch {
        /* callback errors must not break teardown */
      }
    }
  }

  /**
   * Await the next pause. Pauses that arrived before the call are served
   * from the queue in arrival order (the stream semantics the module doc
   * comment describes); otherwise a waiter is installed that either gets
   * the next event or rejects after `timeoutMs`.
   */
  nextPause(timeoutMs: number): Promise<PausedEvent> {
    const queued = this.pauseQueue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    if (this.disposed) {
      return Promise.reject(new Error("InspectorClient is disposed"));
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const idx = this.pauseWaiters.indexOf(waiter);
          if (idx !== -1) {
            this.pauseWaiters.splice(idx, 1);
          }
          reject(
            new Error(`Timed out after ${timeoutMs}ms waiting for a pause`),
          );
        }, timeoutMs),
      };
      waiter.timer.unref?.();
      this.pauseWaiters.push(waiter);
    });
  }

  /** URL a scriptId was parsed from (via `Debugger.scriptParsed`), if seen. */
  scriptUrl(scriptId: string): string | undefined {
    return this.scriptUrls.get(scriptId);
  }

  /** Close the WebSocket and fail all in-flight requests and pause waiters.
   * Idempotent. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.failAll(new Error("InspectorClient disposed"));
    // Listeners off first so the close event doesn't re-enter failAll with
    // a misleading "connection closed" error after a deliberate dispose.
    this.ws.removeAllListeners();
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }

  // ---------------------------------------------------------- receive ----

  private handleMessage(data: WebSocket.RawData): void {
    let msg: {
      id?: number;
      result?: unknown;
      error?: { message?: string; code?: number };
      method?: string;
      params?: Record<string, unknown>;
    };
    try {
      msg = JSON.parse(String(data));
    } catch {
      return; // Not JSON — nothing in CDP is ever non-JSON; ignore.
    }

    // Response to one of our requests: correlate by id.
    if (typeof msg.id === "number") {
      const pending = this.pending.get(msg.id);
      if (!pending) {
        return; // Response to a request we already failed/abandoned.
      }
      this.pending.delete(msg.id);
      if (msg.error) {
        pending.reject(
          new Error(
            `CDP ${pending.method} failed: ${msg.error.message ?? "unknown error"}` +
              (msg.error.code !== undefined ? ` (code ${msg.error.code})` : ""),
          ),
        );
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Event.
    switch (msg.method) {
      case "Debugger.scriptParsed": {
        const p = msg.params as { scriptId?: string; url?: string } | undefined;
        if (p?.scriptId && p.url) {
          this.scriptUrls.set(p.scriptId, p.url);
        }
        break;
      }
      case "Debugger.paused":
        this.handlePaused(msg.params ?? {});
        break;
      case "Debugger.resumed":
        for (const cb of this.resumedCallbacks) {
          try {
            cb();
          } catch {
            /* callback errors must not break the message loop */
          }
        }
        break;
      default:
        break; // Other CDP events aren't needed by this client.
    }
  }

  private handlePaused(params: Record<string, unknown>): void {
    const rawFrames = (params.callFrames ?? []) as Array<{
      functionName?: string;
      location?: {
        scriptId?: string;
        lineNumber?: number;
        columnNumber?: number;
      };
      url?: string;
      scopeChain?: Array<{ type?: string; object?: { objectId?: string } }>;
    }>;
    const event: PausedEvent = {
      reason: params.reason as string | undefined,
      hitBreakpoints: params.hitBreakpoints as string[] | undefined,
      callFrames: rawFrames.map((f) => {
        const scriptId = f.location?.scriptId ?? "";
        return {
          functionName: f.functionName ?? "",
          location: {
            scriptId,
            lineNumber: f.location?.lineNumber ?? 0,
            columnNumber: f.location?.columnNumber,
          },
          // Attribute the frame to a file even when CDP omits url on the
          // frame — that's what the scriptParsed bookkeeping is FOR.
          url: f.url ?? this.scriptUrls.get(scriptId),
          scopeChain: (f.scopeChain ?? []).map((s) => ({
            type: s.type ?? "",
            object: { objectId: s.object?.objectId },
          })),
        };
      }),
    };

    for (const cb of this.pausedCallbacks) {
      try {
        cb(event);
      } catch {
        /* callback errors must not break the message loop */
      }
    }

    // Hand to the oldest waiter if one is parked, else queue — never drop:
    // the break-on-start pause and the first breakpoint hit can both land
    // before the caller gets around to awaiting nextPause().
    const waiter = this.pauseWaiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    } else {
      this.pauseQueue.push(event);
    }
  }

  /** Reject every in-flight request and pause waiter (close/error paths). */
  private failAll(err: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(err);
    }
    this.pending.clear();
    for (const waiter of this.pauseWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }
}
