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
  jobDocument,
  type LaunchResult,
  launch,
  type OperationScope,
  terminate,
  validateBaseConfig,
  validateRequest,
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
 * Between jobs, the worker in the MicroVM suspends its own MicroVM when no
 * job has run for `autoSuspendIdleTime`. The default is 60 seconds, or the
 * session `timeout` if that is shorter. A session shorter than 10 seconds
 * does not suspend by default. The next `vm.invoke` resumes it. See
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
 * no separate readiness wait, which would cost one more invocation. Before
 * each job, the request step calls GetMicrovm. It resumes a suspended
 * MicroVM, and it returns at once for a new MicroVM that is still booting.
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
 * `map` item's context:
 * ```typescript
 * const result = await microvmSession(context, "pipeline", config, async (vm, ctx) => {
 *   const build = await vm.invoke("build", input, { path: "/build", timeout: { minutes: 15 } });
 *   return vm.invoke("test", build, { path: "/test", timeout: { minutes: 10 } });
 * });
 * ```
 *
 * @param context - The context to create the durable operations in.
 * @param name - The child context name. It also prefixes the session's own
 * operation names.
 * @param config - The MicroVM configuration. `timeout` bounds the whole
 * session.
 * @param handler - Sends the jobs. It receives the session handle and the
 * session's child context.
 * @returns The handler's return value.
 * @throws \{TypeError\} When `name`, `imageIdentifier`, `executionRoleArn`, or
 * `handler` is invalid.
 * @throws \{RangeError\} When `timeout` is not between 1 second and 8 hours,
 * or `autoSuspendIdleTime` is shorter than 10 seconds or longer than
 * `timeout`.
 * @throws \{TypeError\} When `autoSuspendIdleTime` is set while
 * `autoSuspendOnIdle` is `false`.
 * @throws \{MicrovmLaunchError\} When the launch fails after all retries.
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
    if (typeof handler !== "function") {
      throw new TypeError(
        `MicroVM session "${name}": handler must be a function`,
      );
    }
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
      const launched = await inStage(name, "launch", () =>
        launch(child, scope, {
          tokenSource: sessionId,
          timeoutSeconds,
          defaultIngress: "ALL_INGRESS",
          runHookPayload: JSON.stringify(payload),
          needsEndpoint: true,
          extra: config.idlePolicy ? { idlePolicy: config.idlePolicy } : {},
        }),
      );

      // The worker suspends the MicroVM when it has been idle, and an idle
      // policy can suspend it too. Either way, each job must resume it first.
      const resumeBeforeDelivery =
        autoSuspendIdleSeconds !== undefined || config.idlePolicy !== undefined;

      try {
        return await handler(
          createSession(child, scope, launched, resumeBeforeDelivery),
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
  if (config.autoSuspendOnIdle === false) {
    if (config.autoSuspendIdleTime !== undefined) {
      throw new TypeError(
        `MicroVM session "${name}": autoSuspendIdleTime is set, but autoSuspendOnIdle is false`,
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
 * Creates the session handle for one context.
 *
 * Each `invoke` creates its durable operations in `context`. So a handle
 * made for the session's child context must not be used inside a nested
 * child context. `withContext` returns a handle for the nested context.
 */
function createSession(
  context: DurableContext,
  scope: OperationScope,
  launched: LaunchResult,
  resumeBeforeDelivery: boolean,
): MicrovmSession {
  return {
    microvmId: launched.microvmId,
    invoke: <TOutput = unknown, TInput = unknown>(
      jobName: string,
      input: TInput,
      options: MicrovmInvokeOptions,
    ): DurablePromise<TOutput> =>
      invokeJob<TOutput, TInput>(
        context,
        scope,
        launched,
        resumeBeforeDelivery,
        jobName,
        input,
        options,
      ),
    withContext: (other: DurableContext): MicrovmSession =>
      createSession(other, scope, launched, resumeBeforeDelivery),
  };
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
  resumeBeforeDelivery: boolean,
  jobName: string,
  input: TInput,
  options: MicrovmInvokeOptions,
): DurablePromise<TOutput> {
  try {
    if (typeof jobName !== "string" || jobName.length === 0) {
      throw new TypeError(
        `MicroVM session "${scope.name}": invoke requires a non-empty job name`,
      );
    }
    validateRequest(jobName, options);
    validateTimeout(jobName, "timeout", options.timeout);
  } catch (error) {
    return new DurablePromise<TOutput>(() => Promise.reject(error));
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
          jobDocument(callbackId, input, options.heartbeatTimeout),
          { resume: resumeBeforeDelivery },
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
