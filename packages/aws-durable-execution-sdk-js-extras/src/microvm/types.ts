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
   * requires the `ready` image hook. `@aws/durable-execution-sdk-js-microvm-worker`
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

  /** The fetch implementation for HTTP delivery. Defaults to the global `fetch`. */
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
   * waits for that job's own `timeout`. So a job that is still running when
   * the MicroVM ends waits until its own timeout, unless it has a
   * `heartbeatTimeout`. For example, a session with a 1-hour timeout starts
   * a job with an 8-hour timeout at 0:58. The service terminates the MicroVM
   * at about 1:05. Without a heartbeat timeout, the job fails at 8:58. So set
   * a `heartbeatTimeout` on every `vm.invoke`.
   */
  timeout: Duration;

  /**
   * The MicroVM idle policy. Not set by default.
   *
   * With {@link autoSuspendOnIdle}, the session suspends an idle MicroVM
   * itself, and it counts running jobs. An idle policy counts only inbound
   * traffic, and a running job receives none. So
   * `maxIdleDurationSeconds` must be longer than the longest job, or the
   * service suspends the MicroVM during that job. Set it only for a MicroVM
   * that serves inbound traffic of its own.
   */
  idlePolicy?: IdlePolicy;

  /**
   * Whether the MicroVM suspends itself when no job has run for
   * {@link autoSuspendIdleTime}. Defaults to `false`.
   *
   * It is off by default because it needs more permissions and changes what
   * the MicroVM does between jobs:
   *
   * 1. The function's role needs `lambda:GetMicrovm` and
   *    `lambda:ResumeMicrovm`. Without them, every job fails.
   * 2. The MicroVM's role needs `lambda:SuspendMicrovm` on the image. That
   *    permission lets any MicroVM of the image suspend any other.
   * 3. Background processes that an earlier job started stop while the
   *    MicroVM is suspended.
   *
   * Without it, a session needs only the permissions of {@link microvm} with
   * HTTP delivery.
   *
   * A running MicroVM pays compute charges. A suspended MicroVM pays only
   * for snapshot storage and keeps its memory and files. The worker in the
   * MicroVM counts its running jobs. When none has run for the idle time, it
   * calls SuspendMicrovm on its own MicroVM. Before each `vm.invoke`, the
   * request step resumes a suspended MicroVM.
   *
   * "Idle" means only that no job runs in the worker. The worker cannot see
   * other work in the MicroVM. So it also suspends the MicroVM in these cases:
   *
   * - Background processes that an earlier job started.
   * - A MicroVM that serves inbound traffic that is not a job, such as a
   *   preview environment waiting for an approval.
   *
   * Leave it off for such a workload. A resume adds latency to the next job,
   * about 1 second in us-east-1, and the job's `timeout` and
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
   * `timeout`. Use one image per trust boundary. The durable function role
   * needs `lambda:GetMicrovm` and `lambda:ResumeMicrovm`. The worker must be
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
   * only at this timeout, or earlier at its {@link heartbeatTimeout}.
   */
  timeout: Duration;

  /**
   * The maximum time between two heartbeats from the MicroVM for this job.
   * The first period starts before the job is delivered, and the worker
   * sends its first heartbeat when the job arrives. So the first period
   * includes a resume of a suspended MicroVM. Keep it longer than a resume
   * plus the delivery, for example 30 seconds.
   *
   * Set it on every job. It is the only way that a job fails soon after its
   * MicroVM ends, for example at the end of the session's lifetime.
   */
  heartbeatTimeout?: Duration;
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
   * the execution.
   *
   * @throws \{MicrovmJobFailedError\} When the job handler in the MicroVM
   * throws.
   * @throws \{MicrovmTimeoutError\} When the job or its heartbeat times out.
   * @throws \{MicrovmNotRunningError\} When the session's MicroVM has ended,
   * and the session checks the MicroVM state before each job. It checks with
   * `autoSuspendOnIdle: true` or an `idlePolicy`. Otherwise an ended MicroVM
   * fails the job with {@link MicrovmDeliveryError} after the retries.
   * @throws \{MicrovmDeliveryError\} When the request fails after all
   * retries, or the route rejects the job.
   * @throws \{TypeError\} When `context` is not a durable context, or
   * `name`, `path`, or `port` is invalid.
   * @throws \{RangeError\} When `timeout` or `retryWindow` is out of range.
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
 * `@aws/durable-execution-sdk-js-microvm-worker`. The two packages do not
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
