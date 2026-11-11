import type {
  DurableContext,
  DurablePromise,
  Duration,
  RetryDecision,
} from "@aws/durable-execution-sdk-js";
import type {
  IdlePolicy,
  LambdaMicrovmsClient,
  Logging,
} from "@aws-sdk/client-lambda-microvms";

/**
 * HTTP delivery settings for {@link microvm} and {@link MicrovmSession.invoke}.
 *
 * @remarks
 * An HTTP delivery POSTs the job document to a route of the application in
 * the MicroVM. The route must answer with a 2xx status at once and run the
 * job in the background.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmRequestConfig {
  /**
   * The route path, for example `/clone-build`. It must start with `/`.
   *
   * Defaults to {@link DEFAULT_MICROVM_JOB_PATH}. The worker package serves
   * that path with its `handler`. Set a path to send the job to one of your
   * own routes instead. For {@link microvm}, a path also selects HTTP
   * delivery for every input size.
   */
  path?: string;

  /**
   * The port of the route inside the MicroVM. Defaults to 8080, the port that
   * the MicroVM endpoint forwards to by default.
   *
   * It applies only when the job goes over HTTP. Lambda sends the `run` hook
   * to the port in the image's hook configuration, not to this port. So for
   * {@link microvm}, a port without a `path` is used only for an input too
   * large for the `run` hook. Set `path` to send every job to this port.
   */
  port?: number;

  /**
   * How long the request step retries inside one step attempt before it
   * throws and the step retry strategy takes over. Defaults to 60 seconds.
   * It must be between 1 second and 10 minutes. The step also stops 10
   * seconds before the Lambda invocation times out.
   */
  retryWindow?: Duration;
}

/**
 * Configuration that {@link microvm} and {@link microvmSession} share.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmBaseConfig {
  /**
   * The ARN or ID of the MicroVM image to run.
   *
   * The image must enable the `run` lifecycle hook. The service then also
   * requires the `ready` image hook. `@aws/durable-execution-sdk-js-compute-worker/microvm`
   * answers both.
   */
  imageIdentifier: string;

  /** The image version to run. Defaults to the latest active version. */
  imageVersion?: string;

  /**
   * The IAM role that the MicroVM assumes.
   *
   * The MicroVM reports its results through the durable callback APIs. So
   * this role needs `lambda:SendDurableExecutionCallbackSuccess`,
   * `lambda:SendDurableExecutionCallbackFailure`, and
   * `lambda:SendDurableExecutionCallbackHeartbeat` on this function's ARN.
   */
  executionRoleArn: string;

  /**
   * Ingress network connector ARNs.
   *
   * Defaults to the Lambda-provided `NO_INGRESS` connector when the job goes
   * in the `run` hook, because the job then needs no inbound connection. HTTP
   * delivery and sessions default to the Lambda-provided `ALL_INGRESS`
   * connector. A caller that sets connectors for {@link microvm} must allow
   * ingress when an input can exceed the `run` hook limit, because such an
   * input goes over HTTP.
   */
  ingressNetworkConnectors?: string[];

  /**
   * Egress network connector ARNs.
   *
   * Defaults to the Lambda-provided `INTERNET_EGRESS` connector. The MicroVM
   * needs egress to reach the Lambda callback APIs. A VPC connector works only
   * if the VPC can reach the Lambda API.
   */
  egressNetworkConnectors?: string[];

  /** The MicroVM logging configuration. Defaults to the service default. */
  logging?: Logging;

  /**
   * The step retry strategy for the launch, request, and terminate steps.
   * It is the second retry tier: the first tier retries inside one step
   * attempt.
   *
   * A step adds the request ID of a failed AWS call to the message of the
   * AWS SDK error. For an AWS SDK error, the strategy still receives the
   * message without the request ID. So a strategy that matches the message,
   * such as `createRetryStrategy({ retryableErrors: [...] })`, matches the
   * message of the service. The original message applies only during the
   * call. Code that reads `error.message` after the strategy returns sees
   * the request ID. An error that the MicroVM operation creates itself, such
   * as `MicrovmStateError` or "RunMicrovm returned no microvmId", has the
   * request ID in its message when the strategy receives it. The handler and
   * the execution history get the message with the request ID.
   *
   * Defaults to {@link defaultMicrovmRetryStrategy}.
   */
  retryStrategy?: (error: Error, attemptCount: number) => RetryDecision;

  /**
   * The client for the Lambda MicroVMs API.
   *
   * Defaults to one client per Region, created on first use. The Region comes
   * from the durable execution ARN.
   */
  client?: LambdaMicrovmsClient;

  /**
   * The fetch implementation for HTTP delivery. Defaults to the global `fetch`.
   *
   * A custom `fetch` must honor `init.redirect`. The request step sets it to
   * `"manual"`. A redirect that the `fetch` follows anyway still fails the
   * delivery, but only after the target has received the request and its
   * auth token.
   */
  fetch?: typeof fetch;
}

/**
 * Configuration for {@link microvm}.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmConfig extends MicrovmBaseConfig {
  /**
   * The maximum time to wait for the MicroVM to report a result.
   *
   * A MicroVM lives at most 8 hours. So the timeout must be between 1 second
   * and 8 hours. The MicroVM's `maximumDurationInSeconds` is set to this
   * timeout plus 5 minutes, capped at 8 hours.
   */
  timeout: Duration;

  /**
   * The maximum time between two heartbeats from the MicroVM.
   *
   * When it is set, a MicroVM that fails to boot or stops responding fails the
   * operation after this duration, instead of after `timeout`. The MicroVM
   * receives this value in the job document.
   *
   * The first period starts when the callback is created, before the launch.
   * So it must cover the launch, with its retries, and the boot. A throttled
   * launch can take several minutes. With a shorter heartbeat timeout, the
   * operation fails with `MicrovmTimeoutError` before the MicroVM sends its
   * first heartbeat.
   */
  heartbeatTimeout?: Duration;

  /**
   * HTTP delivery settings.
   *
   * The operation picks the delivery itself. A job whose `run` hook payload
   * fits in {@link MAX_RUN_HOOK_PAYLOAD_LENGTH} Unicode code points goes in
   * the `run`
   * hook. A larger job goes over HTTP to `request.path`, which defaults to
   * {@link DEFAULT_MICROVM_JOB_PATH}. Setting `request.path` sends every job
   * over HTTP to that route.
   */
  request?: MicrovmRequestConfig;
}

/**
 * Configuration for {@link microvmSession}.
 *
 * @remarks
 * To suspend a MicroVM, set `idlePolicy` with `autoResumeEnabled: true`.
 * The SDK does not resume a MicroVM; the service resumes it on the next
 * request. This applies to {@link MicrovmSessionConfig.autoSuspendOnIdle}
 * and to {@link MicrovmInvokeOptions.suspendAfter}.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmSessionConfig extends MicrovmBaseConfig {
  /**
   * The lifetime of the session's MicroVM, including durable waits between
   * jobs.
   *
   * The MicroVM's `maximumDurationInSeconds` is set to this timeout plus 5
   * minutes, capped at 8 hours. The service then terminates the MicroVM. A
   * MicroVM lives at most 8 hours, running or suspended. So the timeout must
   * be between 1 second and 8 hours. The session also uses it to cap the
   * default {@link autoSuspendIdleTime}.
   *
   * The timeout does not limit the handler or its jobs. Each job's callback
   * waits for that job's own `timeout`. For example, a session with a 1-hour
   * timeout starts a job with an 8-hour timeout at 0:58. The service
   * terminates the MicroVM at about 1:05.
   *
   * - When the image enables the `terminate` hook, the job fails at about
   *   1:05 with a `MicrovmJobFailedError` whose message contains
   *   `(MicrovmTerminatedError)`.
   * - Lambda does not call the hook for a suspended MicroVM, or when the
   *   image disables it. The job then fails at its `heartbeatTimeout`, or at
   *   8:58 without one.
   *
   * So enable the `terminate` hook in the image, and set a
   * `heartbeatTimeout` on every `vm.invoke`.
   */
  timeout: Duration;

  /**
   * The MicroVM idle policy. Not set by default. RunMicrovm sets it once, at
   * the launch.
   *
   * To suspend a MicroVM, set `idlePolicy` with `autoResumeEnabled: true`.
   * The SDK does not resume a MicroVM; the service resumes it on the next
   * request. So {@link autoSuspendOnIdle} and
   * {@link MicrovmInvokeOptions.suspendAfter} need it.
   *
   * Set `maxIdleDurationSeconds` above `maximumDurationInSeconds` (the
   * operation timeout plus 5 minutes). The idle timer counts only inbound
   * requests, so a shorter value suspends a running job. Set
   * `suspendedDurationSeconds` to the session `timeout` or more. The service
   * requires all three fields, and `maxIdleDurationSeconds` of at least 60.
   *
   * Without `autoResumeEnabled`, a job after a suspend fails after its
   * retries with `MicrovmDeliveryError`. With the default retry strategy,
   * that takes about 6 minutes.
   *
   * A job that arrives more than about 5 seconds after a suspend takes about
   * 1 s longer. A job sent right after a suspend can take up to about 10
   * seconds.
   *
   * ```typescript
   * idlePolicy: {
   *   autoResumeEnabled: true,
   *   maxIdleDurationSeconds: 86_400,
   *   suspendedDurationSeconds: 28_800,
   * },
   * ```
   */
  idlePolicy?: IdlePolicy;

  /**
   * Whether the MicroVM suspends itself when no job has run for
   * {@link autoSuspendIdleTime}. Defaults to `false`.
   *
   * It is off by default because it needs more setup and changes what the
   * MicroVM does between jobs:
   *
   * 1. To suspend a MicroVM, set {@link idlePolicy} with
   *    `autoResumeEnabled: true`. The SDK does not resume a MicroVM; the
   *    service resumes it on the next request. Without `autoResumeEnabled`,
   *    a job after a suspend fails after its retries with
   *    `MicrovmDeliveryError`.
   * 2. The MicroVM's role needs `lambda:SuspendMicrovm` on the image. That
   *    permission lets any MicroVM of the image suspend any other.
   * 3. Background processes that an earlier job started stop while the
   *    MicroVM is suspended.
   *
   * The function's role needs only the permissions of {@link microvm} with
   * HTTP delivery.
   *
   * A running MicroVM pays compute charges. A suspended MicroVM pays only
   * for snapshot storage and keeps its memory and files. The worker in the
   * MicroVM counts its running jobs. When none has run for the idle time, it
   * calls SuspendMicrovm on its own MicroVM. The service resumes it when the
   * next `vm.invoke` sends its request.
   *
   * "Idle" means only that no job runs in the worker. The worker cannot see
   * other work in the MicroVM. So it also suspends the MicroVM in these cases:
   *
   * - Background processes that an earlier job started.
   * - A MicroVM that serves inbound traffic that is not a job, such as a
   *   preview environment waiting for an approval.
   *
   * Leave it off for such a workload. A job that arrives more than about 5
   * seconds after a suspend takes about 1 s longer, measured in us-east-1,
   * and the job's `timeout` and
   * `heartbeatTimeout` count that latency. Suspending does not extend the
   * MicroVM's lifetime.
   *
   * The image should enable the `resume` lifecycle hook. The worker refuses
   * jobs from the moment it starts to suspend, because a job accepted then
   * would freeze with the MicroVM. The `resume` hook ends that refusal at
   * once. Without the hook, the refusal ends 30 seconds after the suspend,
   * so the first job after a resume can wait up to 30 seconds. A
   * `request.retryWindow` under 30 seconds then ends its first retry tier
   * first, and the step retry strategy must cover the rest. The default
   * strategy does, at the cost of extra invocations. The hook also lets the
   * worker suspend again after a resume that brings no job.
   *
   * The MicroVM's execution role needs `lambda:SuspendMicrovm` on the
   * MicroVM image. Without it, the worker logs a warning, and the MicroVM
   * keeps running. The action authorizes on the image. So code in any
   * MicroVM of that image can suspend any other MicroVM of that image, even
   * during a job. That job then waits until its `heartbeatTimeout` or its
   * `timeout`. Use one image per trust boundary. The worker must be
   * a version that supports the setting. An older worker ignores it, and its
   * MicroVM keeps running.
   */
  autoSuspendOnIdle?: boolean;

  /**
   * How long the worker waits with no running job before it suspends the
   * MicroVM. Defaults to 60 seconds, or to the session `timeout` if that is
   * shorter. Applies only when {@link autoSuspendOnIdle} is `true`, and
   * setting it otherwise throws a `TypeError`. With suspending on, a session
   * whose `timeout` is under 10 seconds still does not suspend by default.
   *
   * A shorter time saves more compute during long waits. It also makes
   * back-to-back jobs more likely to pay for a suspend and a resume that
   * they do not need. It must be at least 10 seconds, and not longer than
   * the session `timeout`. A resumed MicroVM needs a few seconds before its
   * job arrives, so a shorter time could suspend it again first.
   */
  autoSuspendIdleTime?: Duration;
}

/**
 * Options for one {@link MicrovmSession.invoke} call.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmInvokeOptions extends MicrovmRequestConfig {
  /**
   * The maximum time to wait for this job's result. At most 8 hours. The
   * time starts before the job is delivered. So it includes a resume of a
   * suspended MicroVM.
   *
   * The session's `timeout` does not shorten it. The session's MicroVM ends
   * at the session `timeout` plus 5 minutes. A job still running then fails
   * at once when the image enables the `terminate` hook. Otherwise it fails
   * at this timeout, or earlier at its {@link heartbeatTimeout}.
   */
  timeout: Duration;

  /**
   * The maximum time between two heartbeats from the MicroVM for this job.
   * The first period starts before the job is delivered, and the worker
   * sends its first heartbeat when the job arrives. So the first period
   * includes a resume of a suspended MicroVM. Keep it longer than a resume
   * plus the delivery, for example 30 seconds.
   *
   * Set it on every job. A MicroVM that ends while suspended, or whose image
   * disables the `terminate` hook, reports nothing. The heartbeat timeout is
   * then the only way that the job fails soon after the MicroVM ends.
   *
   * A job after a {@link suspendAfter} job waits until the service resumes
   * the MicroVM. Without the image's `resume` hook, the worker can refuse it
   * with HTTP 503 for up to 30 seconds after the suspend. So set the
   * heartbeat timeout of such a job to at least the `retryWindow` plus 30
   * seconds.
   */
  heartbeatTimeout?: Duration;

  /**
   * Whether the durable function suspends the MicroVM after this job.
   * Defaults to `false`.
   *
   * 1. The durable function calls SuspendMicrovm with the session's MicroVM
   *    ID after this job's result arrives, whether the job succeeded or
   *    failed. The call runs inside the job's child context, before it
   *    returns. The MicroVM does not suspend itself for this.
   * 2. Do not use it on a job that runs next to other jobs of the session,
   *    such as in `map`, `parallel`, or a promise combinator. Those jobs
   *    freeze until the next request resumes the MicroVM, and can hit their
   *    heartbeat timeout.
   * 3. The suspend runs inside the job's child context, so it follows the
   *    child context replay rules. A result larger than the child context
   *    checkpoint limit makes the child context run again on replay, and
   *    each run suspends again.
   * 4. A retry after the Lambda invocation fails can send the suspend again.
   *    The invocation can also end while the call runs, when other
   *    operations wait. The call is then sent again. Suspending a suspended
   *    MicroVM succeeds.
   * 5. The function's execution role needs `lambda:SuspendMicrovm` on the
   *    MicroVM image. The MicroVM's role does not need it for this setting.
   * 6. Adding or removing `suspendAfter` changes what the session does on
   *    replay. Change it only through a new function version.
   * 7. To suspend a MicroVM, set {@link MicrovmSessionConfig.idlePolicy}
   *    with `autoResumeEnabled: true`. The SDK does not resume a MicroVM;
   *    the service resumes it on the next request. Without
   *    `autoResumeEnabled`, a job after a suspend fails after its retries
   *    with `MicrovmDeliveryError`.
   *
   * The call stops at the invocation reserve, as the other calls of the
   * session do. A failed or stopped SuspendMicrovm call logs a warning and
   * does not fail the job. A replay of a completed job sends no second
   * suspend. For about 5 seconds after a suspend, the endpoint answers HTTP
   * 502 with `x-aws-proxy-error: MICROVM_CONNECT_FAILED`, and does not
   * resume the MicroVM. The request step retries that 502. So a job right
   * after a `suspendAfter` job still arrives, after the window. With a
   * `retryWindow` under about 9 seconds, the step retry strategy covers the
   * rest of that window, at the cost of one or two more step attempts. A job
   * sent right after a suspend can take up to about 10 seconds.
   *
   * Set it on the job before a long wait, such as a durable wait or a
   * callback. Do not set it on back-to-back jobs, or on the last job of the
   * session. Each suspend and resume costs a snapshot, and a job that
   * arrives after the window takes about 1 s longer. The session terminates
   * the MicroVM after its last job anyway.
   *
   * Only {@link MicrovmSession.invoke} accepts it. {@link microvm} throws a
   * `TypeError` for it in `config.request`. A value that is not a boolean
   * throws a `TypeError` too.
   */
  suspendAfter?: boolean;
}

/**
 * The handle that a {@link microvmSession} handler receives.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmSession {
  /** The ID of the session's MicroVM. */
  readonly microvmId: string;

  /**
   * Sends one job to the session's MicroVM and returns the job's result.
   *
   * @remarks
   * The job goes over HTTP to `options.path`. Without a path, it goes to
   * {@link DEFAULT_MICROVM_JOB_PATH}, which the worker serves with its
   * `handler`.
   *
   * Each call creates a child context named `name` in `context`, with a job
   * callback `<name>.callback` and a request step `<name>.request`. Pass the
   * context that the call runs in, as for {@link microvm}: the session's
   * child context, or a nested one, such as a `map` item's context. A durable
   * operation created in a parent context from inside a child context fails
   * the execution. `invoke` checks `name`, `options`, and `input` first, and
   * then calls `context.runInChildContext`. So a `context` without that
   * function makes `invoke` throw a `TypeError` itself, instead of returning
   * a rejected promise. No job operation is created then.
   *
   * The call encodes `input` with `JSON.stringify` once, when `invoke` is
   * called. So a `toJSON` method runs once per call, and each replay calls
   * `invoke` again. The call measures that JSON text, and the request sends
   * exactly that text. The input must be the same on every replay.
   *
   * A call with `options.suspendAfter` set to `true` makes the durable
   * function suspend the MicroVM after the job's result arrives. The service
   * resumes it on the next request when the session sets an `idlePolicy`
   * with `autoResumeEnabled: true`. See
   * {@link MicrovmInvokeOptions.suspendAfter}.
   *
   * @throws \{MicrovmJobFailedError\} When the job handler in the MicroVM
   * throws.
   * @throws \{MicrovmTimeoutError\} When the job or its heartbeat times out.
   * @throws \{MicrovmNotRunningError\} When the session's MicroVM has ended.
   * The request step checks the MicroVM state after an HTTP 502 with
   * `x-aws-proxy-error: MICROVM_CONNECT_FAILED` or a request without an
   * answer. It also reports it when CreateMicrovmAuthToken reports the
   * MicroVM removed.
   * @throws \{MicrovmDeliveryError\} When the request fails after all
   * retries, or the route rejects the job. A suspended MicroVM that the
   * service does not resume fails the delivery this way. A denied
   * GetMicrovm in the check after a sign that the MicroVM does not run
   * fails it at once. The message names the permission.
   * @throws \{TypeError\} When `name`, `path`, or `port` is invalid,
   * `suspendAfter` is not a boolean, or `JSON.stringify` cannot encode
   * `input`.
   * @throws \{RangeError\} When `timeout` or `retryWindow` is out of range,
   * or the JSON form of `input` has more than {@link MAX_JOB_INPUT_BYTES}
   * UTF-8 bytes.
   */
  invoke<TOutput = unknown, TInput = unknown>(
    context: DurableContext,
    name: string,
    input: TInput,
    options: MicrovmInvokeOptions,
  ): DurablePromise<TOutput>;
}

/**
 * A {@link microvmSession} handler.
 *
 * @public
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type MicrovmSessionHandler<TOutput> = (
  vm: MicrovmSession,
  context: DurableContext,
) => Promise<TOutput>;

/**
 * One job: the part of the contract that both delivery methods share.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmJobDocument<TInput = unknown> {
  /** The callback ID that the MicroVM completes with the job's outcome. */
  callbackId: string;

  /** The heartbeat timeout in seconds, when the caller set one. */
  heartbeatTimeoutSeconds?: number;

  /** The caller's input. */
  input: TInput;
}

/**
 * The JSON document that {@link microvm} passes to the MicroVM as
 * `runHookPayload`.
 *
 * @remarks
 * This is the same contract as `MicrovmRunHookPayload` in
 * `@aws/durable-execution-sdk-js-compute-worker/microvm`. The two packages do not
 * depend on each other, because one runs in the function and the other in
 * the MicroVM. So a change to one declaration must be made in the other too.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmRunHookPayload<TInput = unknown> {
  /**
   * The payload format version. Code in the MicroVM must reject a version it
   * does not know.
   */
  version: 1;

  /** The Region of the durable function, for the callback API calls. */
  region: string;

  /** The job, when it is delivered through the `run` hook. */
  job?: MicrovmJobDocument<TInput>;

  /**
   * Suspend the MicroVM after it has run no job for this many seconds. Only
   * a session sets it. Without it, the worker never suspends the MicroVM.
   */
  autoSuspendIdleSeconds?: number;
}

/**
 * The body of the HTTP request that delivers a job.
 *
 * @remarks
 * The body repeats `version` and `region`, because the MicroVM may not have
 * received them in a `run` hook payload.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface MicrovmJobRequest<TInput = unknown>
  extends MicrovmJobDocument<TInput> {
  /** The payload format version. */
  version: 1;

  /** The Region of the durable function, for the callback API calls. */
  region: string;

  /**
   * The MicroVM identifier. A job request can reach the worker before the
   * `run` hook, which also carries the identifier. Until the `run` hook
   * arrives, the worker takes it from the first job request that has one.
   */
  microvmId?: string;
}
