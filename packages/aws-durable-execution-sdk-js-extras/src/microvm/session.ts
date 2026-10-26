import { randomUUID } from "node:crypto";
import {
  type DurableContext,
  DurablePromise,
} from "@aws/durable-execution-sdk-js";
import {
  createJobCallback,
  createScope,
  deliverJob,
  durationToSeconds,
  type LaunchResult,
  launch,
  measuredJob,
  type OperationScope,
  terminate,
  validateBaseConfig,
  validateJobInput,
  validateRequest,
  validateSuspendAfter,
  validateTimeout,
} from "./shared";
import { inStage, microvmErrorMapper, sessionErrorMapper } from "./errors";
import { MicrovmOperationSubType } from "./subtypes";
import type {
  MicrovmInvokeOptions,
  MicrovmRunHookPayload,
  MicrovmSession,
  MicrovmSessionConfig,
  MicrovmSessionHandler,
} from "./types";

/**
 * Runs a handler that sends several jobs to one AWS Lambda MicroVM, and
 * returns the handler's value.
 *
 * @remarks
 * The jobs share the MicroVM's files and processes. So a later job can use
 * what an earlier job wrote. The operation creates its durable operations
 * inside one child context named `name`:
 *
 * 1. `<name>.session` generates a session ID and checkpoints it.
 * 2. `<name>.launch` calls RunMicrovm. The client token is the SHA-256 hex
 *    digest of the session ID. A client token must be unique per launch and
 *    stable across retries. The session ID is random, so it is unique. It is
 *    checkpointed, so every retry and replay reads the same ID.
 * 3. The handler runs with a {@link MicrovmSession} and the child context.
 *    Each `vm.invoke` delivers one job over HTTP and waits for its result.
 *    The handler can use the child context for durable operations between
 *    jobs, such as waits and approvals.
 * 4. `<name>.terminate` calls TerminateMicrovm after the handler returns or
 *    throws.
 *
 * With `autoSuspendOnIdle: true`, the worker in the MicroVM suspends its own
 * MicroVM between jobs, when no job has run for `autoSuspendIdleTime`. The
 * default idle time is 60 seconds, or the session `timeout` if that is
 * shorter. The next `vm.invoke` resumes it. Suspending is off by default. See
 * {@link MicrovmSessionConfig.autoSuspendOnIdle}.
 *
 * Each durable operation records a subtype from
 * {@link MicrovmOperationSubType}: `MicrovmSession` on the child context,
 * `MicrovmSessionId`, `MicrovmLaunch`, and `MicrovmTerminate` on its steps,
 * and `MicrovmSessionJob` on each job's child context. The operations that
 * the handler creates keep their own subtypes.
 *
 * The session sends its first job right after the launch. The MicroVM
 * endpoint holds or refuses requests until the `run` hook returns. The request
 * step retries a refused request inside its own attempt. So the session needs
 * no separate readiness wait, which would cost one more invocation. When the
 * MicroVM can be suspended, the request step calls GetMicrovm before each
 * job. It resumes a suspended MicroVM, and it returns at once for a new
 * MicroVM that is still booting. The launch checkpoint records whether the
 * MicroVM can be suspended. Replay follows that record, not the current
 * config.
 *
 * A job with `suspendAfter` asks the worker to suspend the MicroVM after the
 * job. That job itself and each later job of the handle then check the
 * state before delivery, as with `autoSuspendOnIdle`. The flag is set before
 * the job starts, so the job's own delivery reads it. That record is kept in
 * memory only. So every job of every session also checks the state after a
 * sign of a suspended MicroVM: no answer, or an HTTP 502 with
 * `x-aws-proxy-error: MICROVM_CONNECT_FAILED`. A booting MicroVM gives
 * neither sign, unless the worker takes more than 10 seconds to start
 * listening. Then the first delivery gets no answer, and the operation makes
 * one GetMicrovm call. So a session that never suspends makes no extra call,
 * except in that case. See {@link MicrovmInvokeOptions.suspendAfter}.
 *
 * A failed `vm.invoke` rejects inside the handler. The handler can catch the
 * error and continue with the same MicroVM. An error that leaves the handler
 * ends the session and reaches the caller.
 *
 * The session's value is the handler's return value, checkpointed as the
 * child context result. So it must be JSON-serializable, and it counts toward
 * the checkpoint size limit.
 *
 * Pass the context that the call runs in, such as a child context or a
 * `map` item's context. `vm.invoke` takes its context the same way:
 * ```typescript
 * const result = await microvmSession(context, "pipeline", config, async (vm, ctx) => {
 *   const build = await vm.invoke(ctx, "build", input, { path: "/build", timeout: { minutes: 15 } });
 *   return vm.invoke(ctx, "test", build, { path: "/test", timeout: { minutes: 10 } });
 * });
 * ```
 *
 * @param context - The context to create the durable operations in.
 * @param name - The child context name. It also prefixes the session's own
 * operation names.
 * @param config - The MicroVM configuration. `timeout` bounds the whole
 * session.
 * @param handler - Sends the jobs. It receives the session handle and the
 * session's child context. It must be a function. The session calls it after
 * the launch, inside the child context. So a value that is not a function
 * fails the session with a `TypeError`, wrapped in `ChildContextError`, and
 * the terminate step still ends the MicroVM.
 * @returns The handler's return value.
 * @throws \{TypeError\} When `name` is invalid, or `executionRoleArn` is
 * missing.
 * @throws \{RangeError\} When `timeout` is not between 1 second and 8 hours,
 * or `autoSuspendIdleTime` is shorter than 10 seconds or longer than
 * `timeout`.
 * @throws \{TypeError\} When `autoSuspendIdleTime` is set while
 * `autoSuspendOnIdle` is not `true`.
 * @throws \{MicrovmLaunchError\} When the launch fails after all retries.
 * An empty `imageIdentifier` or `executionRoleArn` fails this way, because
 * `RunMicrovm` rejects it with `ValidationException`.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function microvmSession<TOutput = unknown>(
  context: DurableContext,
  name: string,
  config: MicrovmSessionConfig,
  handler: MicrovmSessionHandler<TOutput>,
): DurablePromise<TOutput> {
  let timeoutSeconds: number;
  let scope: OperationScope;
  let autoSuspendIdleSeconds: number | undefined;
  try {
    timeoutSeconds = validateBaseConfig(name, config);
    autoSuspendIdleSeconds = validateAutoSuspend(name, config, timeoutSeconds);
    scope = createScope(context, name, config);
  } catch (error) {
    return new DurablePromise<TOutput>(() => Promise.reject(error));
  }

  return context.runInChildContext<TOutput>(
    name,
    async (child) => {
      const sessionId = await child.step(
        `${name}.session`,
        async () => randomUUID(),
        { subType: MicrovmOperationSubType.SESSION_ID },
      );

      const payload: MicrovmRunHookPayload = {
        version: 1,
        region: scope.region,
        ...(autoSuspendIdleSeconds !== undefined && { autoSuspendIdleSeconds }),
      };
      // The worker suspends the MicroVM when it has been idle, and an idle
      // policy can suspend it too. Either way, each job must resume it first.
      const resumeFromConfig =
        autoSuspendIdleSeconds !== undefined || config.idlePolicy !== undefined;
      const launched = await inStage(name, "launch", () =>
        launch(child, scope, {
          tokenSource: sessionId,
          timeoutSeconds,
          defaultIngress: "ALL_INGRESS",
          runHookPayload: JSON.stringify(payload),
          delivery: "http",
          resumeBeforeDelivery: resumeFromConfig,
          extra: config.idlePolicy ? { idlePolicy: config.idlePolicy } : {},
        }),
      );

      // 1. The worker reads its idle time once, from the run hook payload of
      //    the launch. RunMicrovm sets the idle policy once, at the launch.
      // 2. The launch step's result comes from the checkpoint on replay.
      // 3. So a deploy that changes autoSuspendOnIdle or idlePolicy does not
      //    change what the running MicroVM does.
      // 4. A job that skips the state check of a suspended MicroVM gets a
      //    502, or no answer. The request step then checks the state, and
      //    resumes the MicroVM. That costs a failed request per job.
      // 5. So each job follows the resume mode that the launch recorded, not
      //    the current config.
      // Every session launch records a boolean. So only `true` turns the
      // state check on. A missing field, or any other value, reads as false.
      const resumeBeforeDelivery = launched.resumeBeforeDelivery === true;

      try {
        return await handler(
          createSession(scope, launched, resumeBeforeDelivery, sessionId),
          child,
        );
      } finally {
        await terminate(child, scope, launched.microvmId);
      }
    },
    {
      subType: MicrovmOperationSubType.SESSION,
      errorMapper: sessionErrorMapper,
    },
  );
}

/**
 * The default {@link MicrovmSessionConfig.autoSuspendIdleTime}, in seconds.
 *
 * A resume took about 1 second in us-east-1. So 60 seconds keeps back-to-back
 * jobs from paying for a suspend and a resume that they do not need. A long
 * wait costs at most 60 seconds of compute before the MicroVM suspends. A
 * session whose `timeout` is shorter uses its `timeout`. A session whose
 * `timeout` is under 10 seconds does not suspend by default.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const DEFAULT_AUTO_SUSPEND_IDLE_SECONDS = 60;

/**
 * The shortest idle time a session accepts. A resumed MicroVM runs its
 * `resume` hook, reports RUNNING at the next state poll, and then receives
 * the job after a new auth token. That path can take a few seconds. A
 * shorter idle time could suspend the MicroVM again before its job arrives.
 */
const MIN_AUTO_SUSPEND_IDLE_SECONDS = 10;

/**
 * Checks the auto-suspend settings, and returns the idle time in seconds, or
 * `undefined` when the MicroVM must not suspend itself.
 */
function validateAutoSuspend(
  name: string,
  config: MicrovmSessionConfig,
  timeoutSeconds: number,
): number | undefined {
  // Suspending is opt-in. It needs lambda:GetMicrovm and
  // lambda:ResumeMicrovm in the function's role, and lambda:SuspendMicrovm in
  // the MicroVM's role. It also stops background processes between jobs.
  if (config.autoSuspendOnIdle !== true) {
    if (config.autoSuspendIdleTime !== undefined) {
      throw new TypeError(
        `MicroVM session "${name}": autoSuspendIdleTime is set, but autoSuspendOnIdle is not true`,
      );
    }
    return undefined;
  }
  if (config.autoSuspendIdleTime === undefined) {
    // A session shorter than the minimum idle time does not suspend. Its
    // MicroVM would suspend again before a resumed job arrives.
    if (timeoutSeconds < MIN_AUTO_SUSPEND_IDLE_SECONDS) {
      return undefined;
    }
    return Math.min(DEFAULT_AUTO_SUSPEND_IDLE_SECONDS, timeoutSeconds);
  }
  const idleSeconds = durationToSeconds(config.autoSuspendIdleTime);
  if (
    !Number.isFinite(idleSeconds) ||
    idleSeconds < MIN_AUTO_SUSPEND_IDLE_SECONDS
  ) {
    throw new RangeError(
      `MicroVM session "${name}": autoSuspendIdleTime must be at least ${MIN_AUTO_SUSPEND_IDLE_SECONDS} seconds`,
    );
  }
  if (idleSeconds > timeoutSeconds) {
    throw new RangeError(
      `MicroVM session "${name}": autoSuspendIdleTime must not be longer than timeout`,
    );
  }
  return idleSeconds;
}

/**
 * Creates the session handle.
 *
 * Each `invoke` creates its durable operations in the context that the caller
 * passes, as `microvm` does. A durable operation created in a parent context
 * from inside a child context fails the execution. So the handle holds no
 * context of its own, and one handle works in the session's child context,
 * in a nested child context, and in `map` and `parallel` items.
 */
function createSession(
  scope: OperationScope,
  launched: LaunchResult,
  resumeBeforeDelivery: boolean,
  sessionId: string,
): MicrovmSession {
  const state: SessionState = {
    resumeBeforeDelivery,
    maybeSuspended: false,
    sessionId,
  };
  return {
    microvmId: launched.microvmId,
    invoke: <TOutput = unknown, TInput = unknown>(
      context: DurableContext,
      jobName: string,
      input: TInput,
      options: MicrovmInvokeOptions,
    ): DurablePromise<TOutput> =>
      invokeJob<TOutput, TInput>(
        context,
        scope,
        launched,
        state,
        jobName,
        input,
        options,
      ),
  };
}

/** The state of one session handle. */
interface SessionState {
  /** The resume mode that the launch recorded. */
  readonly resumeBeforeDelivery: boolean;
  /**
   * Set by the first `suspendAfter` job of this handle. Later jobs then
   * check the state before delivery. It only changes from `false` to
   * `true`.
   *
   * The flag lives in memory only. A replay of a completed job calls
   * `invoke` again, so it sets the flag again. A replay of a completed child
   * context or `map` item does not run its function, so it does not call
   * `invoke`, and it does not set the flag. The check after a sign of a
   * suspended MicroVM covers that case. See `resumeIfSuspended`.
   */
  maybeSuspended: boolean;
  readonly sessionId: string;
}

/**
 * Whether a job checks the MicroVM state before delivery. The request step
 * reads it at the start of each attempt.
 */
function resumeMode(state: SessionState): boolean {
  return state.resumeBeforeDelivery || state.maybeSuspended;
}

/**
 * The IDs of the sessions that warned about a worker that ignores
 * `suspendAfter`, oldest first.
 *
 * Each invocation creates a new handle. So the record is kept per process,
 * by session ID. A later invocation in the same execution environment then
 * logs no second warning.
 */
const warnedSessions = new Set<string>();

/**
 * How many session IDs {@link warnedSessions} keeps. A session ID is a
 * UUID, so 1,000 of them use well under 1 MB.
 */
const MAX_WARNED_SESSIONS = 1_000;

/**
 * Returns `true` the first time for a session, so the session warns once
 * about a worker that does not support `suspendAfter`.
 *
 * @internal
 */
export function claimSuspendAfterWarning(sessionId: string): boolean {
  if (warnedSessions.has(sessionId)) {
    return false;
  }
  warnedSessions.add(sessionId);
  if (warnedSessions.size > MAX_WARNED_SESSIONS) {
    // A Set iterates in insertion order. So the first value is the oldest.
    const oldest = warnedSessions.values().next().value as string;
    warnedSessions.delete(oldest);
  }
  return true;
}

/**
 * Delivers one job to the session's MicroVM and waits for its result.
 *
 * The job has the same shape as `microvm` with HTTP delivery, without its own
 * launch and terminate: a child context named `jobName` with subtype
 * `MicrovmSessionJob`, a callback `<jobName>.callback`, and a request step
 * `<jobName>.request`.
 */
function invokeJob<TOutput, TInput>(
  context: DurableContext,
  scope: OperationScope,
  launched: LaunchResult,
  state: SessionState,
  jobName: string,
  input: TInput,
  options: MicrovmInvokeOptions,
): DurablePromise<TOutput> {
  let inputJson: string | undefined;
  let suspendAfter: boolean;
  try {
    if (typeof jobName !== "string" || jobName.length === 0) {
      throw new TypeError(
        `MicroVM session "${scope.name}": invoke requires a non-empty job name`,
      );
    }
    validateRequest(jobName, options);
    validateTimeout(jobName, "timeout", options.timeout);
    suspendAfter = validateSuspendAfter(jobName, options.suspendAfter);
    inputJson = validateJobInput(jobName, input);
  } catch (error) {
    return new DurablePromise<TOutput>(() => Promise.reject(error));
  }
  // The flag is set before the child context. A replay of a completed job
  // returns its result without running the child context's function. So
  // the flag is set on every replay of this call too.
  if (suspendAfter) {
    state.maybeSuspended = true;
  }

  return context.runInChildContext<TOutput>(
    jobName,
    async (jobContext) => {
      const [result, callbackId] = await createJobCallback<TOutput>(
        jobContext,
        jobName,
        options.timeout,
        options.heartbeatTimeout,
      );
      await inStage(jobName, "delivery", () =>
        deliverJob(
          jobContext,
          scope,
          jobName,
          launched,
          options,
          // The request sends the input's JSON text from
          // validateJobInput. So `input` is encoded once per call.
          measuredJob(callbackId, inputJson, options.heartbeatTimeout),
          {
            resume: () => resumeMode(state),
            suspendCheck: true,
            suspendAfter,
            claimSuspendAfterWarning: () =>
              claimSuspendAfterWarning(state.sessionId),
          },
        ),
      );
      return await inStage(jobName, "job", () => result);
    },
    {
      subType: MicrovmOperationSubType.SESSION_JOB,
      errorMapper: microvmErrorMapper(jobName),
    },
  );
}
