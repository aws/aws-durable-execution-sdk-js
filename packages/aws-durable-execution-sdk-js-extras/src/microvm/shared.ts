// Building blocks that microvm() and microvmSession() share: validation, the
// launch step, HTTP job delivery, and the terminate step.
import { createHash } from "node:crypto";
import {
  type DurableContext,
  type Duration,
  defaultSerdes,
  type RetryDecision,
} from "@aws/durable-execution-sdk-js";
import {
  LambdaMicrovmsClient,
  RunMicrovmCommand,
  type RunMicrovmCommandInput,
  TerminateMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import {
  DEFAULT_MICROVM_JOB_PATH,
  DEFAULT_MICROVM_PORT,
  DEFAULT_REQUEST_RETRY_WINDOW_MS,
  sendJob,
} from "./request";
import { ensureRunning } from "./lifecycle";
import { defaultMicrovmRetryStrategy } from "./retry";
import { MicrovmOperationSubType } from "./subtypes";
import type {
  MicrovmBaseConfig,
  MicrovmJobDocument,
  MicrovmJobRequest,
  MicrovmRequestConfig,
} from "./types";

/**
 * RunMicrovm accepts `maximumDurationInSeconds` up to 8 hours.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const MAX_MICROVM_DURATION_SECONDS = 28_800;

/**
 * RunMicrovm accepts a `runHookPayload` of at most 4096 Unicode code points.
 *
 * The service counts code points, not UTF-8 bytes or UTF-16 code units. A
 * probe against the service accepted 1,916 code points in 5,658 bytes, and
 * 4,096 code points of "😀" in 8,149 code units. It rejected 4,097 code
 * points. A code point is at most 4 bytes, so the payload is at most the
 * 16,384 bytes that the API model states.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const MAX_RUN_HOOK_PAYLOAD_LENGTH = 4_096;

/**
 * Returns true when `payload` has at most
 * {@link MAX_RUN_HOOK_PAYLOAD_LENGTH} Unicode code points. A payload that
 * fits goes in the `run` hook. A payload that does not fit goes over HTTP.
 *
 * Why code points:
 *
 * 1. RunMicrovm counts the limit in code points. The probe results are on
 *    {@link MAX_RUN_HOOK_PAYLOAD_LENGTH}.
 * 2. `string.length` counts UTF-16 code units. An emoji is 1 code point and
 *    2 code units. So `string.length` sends a job with emoji over HTTP
 *    before the service limit requires it.
 * 3. A UTF-8 byte count is larger still. "日" is 1 code point and 3 bytes.
 *    So a byte count sends most non-ASCII jobs over HTTP without need.
 * 4. Each extra HTTP delivery gives the MicroVM an ingress connector and
 *    adds a request step. So the check counts exactly what the service
 *    counts.
 *
 * How it counts:
 *
 * 1. A code point is one or two UTF-16 code units.
 * 2. So a string of at most the limit in code units has at most the limit
 *    in code points. It always fits.
 * 3. A string of more than twice the limit in code units has more than the
 *    limit in code points. It never fits.
 * 4. Only a string between those two lengths needs a count. The count stops
 *    at the first code point past the limit.
 *
 * `JSON.stringify` escapes a lone surrogate as `\uXXXX`. So the payload has
 * only well-formed code points, and the count matches the service's count.
 */
export function fitsRunHook(payload: string): boolean {
  // Case 2 above: always fits.
  if (payload.length <= MAX_RUN_HOOK_PAYLOAD_LENGTH) {
    return true;
  }
  // Case 3 above: never fits.
  if (payload.length > 2 * MAX_RUN_HOOK_PAYLOAD_LENGTH) {
    return false;
  }
  // Case 4 above. A string iterator yields one code point per step.
  let codePoints = 0;
  for (const _ of payload) {
    if (++codePoints > MAX_RUN_HOOK_PAYLOAD_LENGTH) {
      return false;
    }
  }
  return true;
}

/**
 * The time added to the operation timeout to get the MicroVM's maximum
 * duration. The margin covers the launch. The MicroVM must outlive every job
 * callback, or the platform terminates it before the job can report.
 */
const LAUNCH_MARGIN_SECONDS = 300;

const defaultClients = new Map<string, LambdaMicrovmsClient>();

/**
 * How the job reaches the MicroVM.
 *
 * - `run-hook`: the job is in the RunMicrovm request's `runHookPayload`.
 * - `http`: the RunMicrovm request has no job. A request step POSTs it to
 *   the MicroVM's endpoint after the launch.
 */
export type JobDelivery = "run-hook" | "http";

/** The checkpointed result of the launch step. */
export interface LaunchResult {
  microvmId: string;
  /** Present only for `http` delivery. */
  endpoint?: string;
  /**
   * The delivery that the launch used. Replay reads it from the checkpoint.
   * So every replay delivers the job the way the launch prepared for.
   */
  delivery: JobDelivery;
}

export type RetryStrategy = (
  error: Error,
  attemptCount: number,
) => RetryDecision;

/** Values that every step of one operation uses. */
export interface OperationScope {
  name: string;
  config: MicrovmBaseConfig;
  partition: string;
  region: string;
  retryStrategy: RetryStrategy;
}

/**
 * Resolves the values that every step of one operation uses.
 *
 * @throws \{TypeError\} When the Region cannot be determined. The MicroVM
 * worker rejects a payload without a Region, and the connector ARNs need it.
 * So the operation fails before any durable operation instead.
 */
export function createScope(
  context: DurableContext,
  name: string,
  config: MicrovmBaseConfig,
): OperationScope {
  const { partition, region } = parseExecutionArn(
    context.executionContext.durableExecutionArn,
  );
  if (!region) {
    throw new TypeError(
      `MicroVM "${name}": cannot determine the AWS Region. The durable execution ARN has none, and AWS_REGION is not set.`,
    );
  }
  return {
    name,
    config,
    partition,
    region,
    retryStrategy: config.retryStrategy ?? defaultMicrovmRetryStrategy,
  };
}

/**
 * Validates the fields that both operations share.
 *
 * @returns The timeout in seconds.
 */
export function validateBaseConfig(
  name: string,
  config: MicrovmBaseConfig & { timeout: Duration },
): number {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("a MicroVM operation requires a non-empty name");
  }
  if (!config?.imageIdentifier) {
    throw new TypeError(`MicroVM "${name}": imageIdentifier is required`);
  }
  if (!config.executionRoleArn) {
    throw new TypeError(`MicroVM "${name}": executionRoleArn is required`);
  }
  return validateTimeout(name, "timeout", config.timeout);
}

/**
 * A MicroVM lives at most 8 hours. So no timeout that the MicroVM must
 * outlive can be longer.
 */
export function validateTimeout(
  name: string,
  field: string,
  timeout: Duration | undefined,
): number {
  const seconds = durationToSeconds(timeout);
  if (
    !Number.isFinite(seconds) ||
    seconds < 1 ||
    seconds > MAX_MICROVM_DURATION_SECONDS
  ) {
    throw new RangeError(
      `MicroVM "${name}": ${field} must be between 1 second and ${MAX_MICROVM_DURATION_SECONDS} seconds (8 hours), because a MicroVM lives at most 8 hours. Got ${seconds} seconds.`,
    );
  }
  return seconds;
}

export function validateRequest(
  name: string,
  request: MicrovmRequestConfig,
): void {
  const { path, port, retryWindow } = request ?? {};
  // No path selects the worker's default job route.
  if (
    path !== undefined &&
    (typeof path !== "string" || !path.startsWith("/"))
  ) {
    throw new TypeError(
      `MicroVM "${name}": the request path must be a string that starts with "/"`,
    );
  }
  if (path?.startsWith("/aws/lambda-microvms/")) {
    throw new TypeError(
      `MicroVM "${name}": the request path must not use the lifecycle hook prefix /aws/lambda-microvms/`,
    );
  }
  if (
    port !== undefined &&
    !(Number.isInteger(port) && port >= 1 && port <= 65_535)
  ) {
    throw new TypeError(
      `MicroVM "${name}": the request port must be an integer between 1 and 65535`,
    );
  }
  if (retryWindow !== undefined) {
    // A NaN window would make the retry tier's deadline NaN, so the tier
    // would never end. A window over 10 minutes outlives the auth token and
    // its one refresh.
    const seconds = durationToSeconds(retryWindow);
    if (
      !Number.isFinite(seconds) ||
      seconds < 1 ||
      seconds > MAX_REQUEST_RETRY_WINDOW_SECONDS
    ) {
      throw new RangeError(
        `MicroVM "${name}": the request retryWindow must be between 1 second and ${MAX_REQUEST_RETRY_WINDOW_SECONDS / 60} minutes`,
      );
    }
  }
}

/** The longest request retry window. */
const MAX_REQUEST_RETRY_WINDOW_SECONDS = 10 * 60;

/**
 * Runs the launch step.
 *
 * The client token must be unique per launch and stable across retries. The
 * caller derives it from a checkpointed value, so a retried or replayed launch
 * returns the same MicroVM.
 */
export function launch(
  child: DurableContext,
  scope: OperationScope,
  options: {
    tokenSource: string;
    timeoutSeconds: number;
    defaultIngress: "NO_INGRESS" | "ALL_INGRESS";
    runHookPayload: string;
    delivery: JobDelivery;
    extra?: Partial<RunMicrovmCommandInput>;
  },
): Promise<LaunchResult> {
  const { config, partition, region } = scope;
  return child.step<LaunchResult>(
    `${scope.name}.launch`,
    async () => {
      const response = await getClient(config, region).send(
        new RunMicrovmCommand({
          imageIdentifier: config.imageIdentifier,
          imageVersion: config.imageVersion,
          executionRoleArn: config.executionRoleArn,
          // A callback ID can be 1024 characters, and the client token
          // allows 128. The digest is 64 characters.
          clientToken: sha256Hex(options.tokenSource),
          ingressNetworkConnectors: config.ingressNetworkConnectors ?? [
            connectorArn(partition, region, options.defaultIngress),
          ],
          egressNetworkConnectors: config.egressNetworkConnectors ?? [
            connectorArn(partition, region, "INTERNET_EGRESS"),
          ],
          maximumDurationInSeconds: Math.min(
            options.timeoutSeconds + LAUNCH_MARGIN_SECONDS,
            MAX_MICROVM_DURATION_SECONDS,
          ),
          logging: config.logging,
          runHookPayload: options.runHookPayload,
          ...options.extra,
        }),
      );
      if (!response.microvmId) {
        throw new Error("RunMicrovm returned no microvmId");
      }
      const overHttp = options.delivery === "http";
      if (overHttp && !response.endpoint) {
        throw new Error("RunMicrovm returned no endpoint");
      }
      return {
        microvmId: response.microvmId,
        ...(overHttp && { endpoint: response.endpoint }),
        delivery: options.delivery,
      };
    },
    {
      retryStrategy: scope.retryStrategy,
      subType: MicrovmOperationSubType.LAUNCH,
    },
  ) as Promise<LaunchResult>;
}

/**
 * Creates a job callback. The MicroVM sends a JSON string, and the default
 * callback deserializer returns the raw string. So the callback parses it.
 */
export function createJobCallback<TOutput>(
  child: DurableContext,
  jobName: string,
  timeout: Duration,
  heartbeatTimeout: Duration | undefined,
): Promise<[Promise<TOutput>, string]> {
  return child.createCallback<TOutput>(`${jobName}.callback`, {
    timeout,
    heartbeatTimeout,
    serdes: defaultSerdes,
    subType: MicrovmOperationSubType.CALLBACK,
  }) as unknown as Promise<[Promise<TOutput>, string]>;
}

export function jobDocument<TInput>(
  callbackId: string,
  input: TInput,
  heartbeatTimeout: Duration | undefined,
): MicrovmJobDocument<TInput> {
  return {
    callbackId,
    ...(heartbeatTimeout !== undefined && {
      heartbeatTimeoutSeconds: durationToSeconds(heartbeatTimeout),
    }),
    input,
  };
}

/**
 * Runs the request step: delivers one job over HTTP with the first retry
 * tier inside the step, and the step retry strategy as the second tier.
 */
export async function deliverJob<TInput>(
  child: DurableContext,
  scope: OperationScope,
  jobName: string,
  launched: LaunchResult,
  request: MicrovmRequestConfig,
  job: MicrovmJobDocument<TInput>,
  options: { resume?: boolean } = {},
): Promise<void> {
  const body: MicrovmJobRequest<TInput> = {
    version: 1,
    region: scope.region,
    microvmId: launched.microvmId,
    ...job,
  };
  await child.step(
    `${jobName}.request`,
    async (stepContext) => {
      const client = getClient(scope.config, scope.region);
      const log = (message: string, data: Record<string, unknown>): void =>
        stepContext.logger.info(`MicroVM "${jobName}": ${message}`, data);
      const retryWindowMs =
        request.retryWindow === undefined
          ? DEFAULT_REQUEST_RETRY_WINDOW_MS
          : durationToSeconds(request.retryWindow) * 1_000;
      // A session MicroVM can be suspended between jobs. So a session job
      // first makes sure the MicroVM runs, and uses the endpoint that
      // GetMicrovm reports now.
      // A transition must fit in the first retry tier, like the request
      // that follows it. A recheck gets what remains of the tier.
      // The state check before delivery and the request's retries share
      // one window. So the wait for a resume counts toward it.
      const windowStartedAt = Date.now();
      const running = (
        maxWaitMs = retryWindowMs,
      ): Promise<string | undefined> =>
        ensureRunning({
          client,
          microvmId: launched.microvmId,
          maxWaitMs,
          remainingTimeMs: remainingTime(child),
          log,
        });
      const endpoint = options.resume
        ? ((await running()) ?? launched.endpoint)
        : launched.endpoint;
      // The launch records an endpoint for every `http` delivery, and the
      // caller delivers over HTTP only then. So a missing endpoint is a
      // defect, not a transient failure. The error name is not retryable,
      // so the step fails at once instead of sending to "https://undefined".
      if (endpoint === undefined) {
        throw new Error(
          `MicroVM "${jobName}": the launch recorded no endpoint for MicroVM ${launched.microvmId}, so the job cannot be sent over HTTP`,
        );
      }
      await sendJob({
        client,
        fetch: scope.config.fetch ?? fetch,
        microvmId: launched.microvmId,
        endpoint,
        path: request.path ?? DEFAULT_MICROVM_JOB_PATH,
        port: request.port ?? DEFAULT_MICROVM_PORT,
        body: JSON.stringify(body),
        retryWindowMs,
        windowStartedAt,
        remainingTimeMs: remainingTime(child),
        log,
        ...(options.resume && { recheck: running }),
      });
    },
    {
      retryStrategy: scope.retryStrategy,
      subType: MicrovmOperationSubType.REQUEST,
    },
  );
}

/**
 * Terminates the MicroVM and logs, instead of throwing, a final failure.
 *
 * When terminate runs, the job callbacks already hold their outcomes, and
 * `maximumDurationInSeconds` bounds how long the MicroVM can keep running. So
 * a terminate failure must not discard those outcomes.
 *
 * The step's failure is checkpointed. So on replay the step fails again at
 * once, this function catches it again, and the outcome stays the same.
 */
export async function terminate(
  child: DurableContext,
  scope: OperationScope,
  microvmId: string,
): Promise<void> {
  try {
    await child.step(
      `${scope.name}.terminate`,
      async () => {
        try {
          await getClient(scope.config, scope.region).send(
            new TerminateMicrovmCommand({ microvmIdentifier: microvmId }),
          );
        } catch (error) {
          // TerminateMicrovm succeeds for an already-terminated MicroVM. A
          // MicroVM whose record the service has already removed returns
          // ResourceNotFoundException. Either way, the MicroVM is gone.
          if ((error as Error).name !== "ResourceNotFoundException") {
            throw error;
          }
        }
      },
      {
        retryStrategy: scope.retryStrategy,
        subType: MicrovmOperationSubType.TERMINATE,
      },
    );
  } catch (error) {
    child.logger.warn(
      `MicroVM "${scope.name}": terminate failed for ${microvmId}. The platform terminates it at maximumDurationInSeconds.`,
      { error },
    );
  }
}

/**
 * Converts a Duration to whole seconds, rounding up.
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function durationToSeconds(duration: Duration | undefined): number {
  if (duration === undefined) {
    return Number.NaN;
  }
  const parts = duration as {
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
  };
  return Math.ceil(
    (parts.days ?? 0) * 86_400 +
      (parts.hours ?? 0) * 3_600 +
      (parts.minutes ?? 0) * 60 +
      (parts.seconds ?? 0),
  );
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Returns a function that reads the invocation's remaining time in
 * milliseconds. The first retry tier uses it to stop before the invocation
 * times out.
 *
 * AWS Lambda's context has `getRemainingTimeInMillis()`. The context of
 * another compute may lack it, or its implementation may throw or return no
 * finite number. The function returns `undefined` in each of these cases. So
 * the caller falls back to its own time limit, and nothing fails.
 */
export function remainingTime(
  context: DurableContext,
): () => number | undefined {
  const lambdaContext = context.lambdaContext as
    | { getRemainingTimeInMillis?: unknown }
    | undefined;
  const read = lambdaContext?.getRemainingTimeInMillis;
  if (typeof read !== "function") {
    return (): undefined => undefined;
  }
  return (): number | undefined => {
    let value: unknown;
    try {
      value = read.call(lambdaContext);
    } catch {
      return undefined;
    }
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  };
}

/**
 * Reads the partition and Region from a durable execution ARN, in the form
 * `arn:<partition>:lambda:<region>:<account>:...`. Falls back to `aws` and
 * `AWS_REGION` when the ARN does not have that form.
 */
function parseExecutionArn(arn: string): {
  partition: string;
  region: string;
} {
  const [prefix, partition, , region] = arn.split(":");
  if (prefix === "arn" && partition && region) {
    return { partition, region };
  }
  return { partition: "aws", region: process.env.AWS_REGION ?? "" };
}

function connectorArn(
  partition: string,
  region: string,
  connector: string,
): string {
  return `arn:${partition}:lambda:${region}:aws:network-connector:aws-network-connector:${connector}`;
}

export function getClient(
  config: MicrovmBaseConfig,
  region: string,
): LambdaMicrovmsClient {
  if (config.client) {
    return config.client;
  }
  let client = defaultClients.get(region);
  if (!client) {
    client = new LambdaMicrovmsClient({ region });
    defaultClients.set(region, client);
  }
  return client;
}
