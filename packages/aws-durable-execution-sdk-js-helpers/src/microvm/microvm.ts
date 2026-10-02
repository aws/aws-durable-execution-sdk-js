import {
  type DurableContext,
  DurablePromise,
} from "@aws/durable-execution-sdk-js";
import {
  createJobCallback,
  createScope,
  deliverJob,
  fitsRunHook,
  jobDocument,
  launch,
  type OperationScope,
  terminate,
  validateBaseConfig,
  validateRequest,
} from "./shared";
import { inStage, microvmErrorMapper } from "./errors";
import { MicrovmOperationSubType } from "./subtypes";
import type { MicrovmConfig, MicrovmRunHookPayload } from "./types";

/**
 * Runs one job in a new AWS Lambda MicroVM and returns the job's result.
 *
 * @remarks
 * The operation creates its durable operations inside one child context named
 * `name`:
 *
 * 1. `<name>.callback` creates a durable callback. The service generates the
 *    callback ID, and the SDK checkpoints it. So the ID is unique to this call
 *    and stays the same on every replay.
 * 2. `<name>.launch` calls RunMicrovm. The client token is the SHA-256 hex
 *    digest of the callback ID. So a retried or replayed launch returns the
 *    same MicroVM instead of starting a second one.
 * 3. The operation picks the delivery. A job whose `run` hook payload fits in
 *    4096 Unicode code points goes in the launch request, and the MicroVM
 *    receives it in the `run` hook. A larger job, or any job with
 *    `config.request.path`, goes over HTTP: `<name>.request` POSTs it after
 *    the launch.
 * 4. The child context waits on the callback. The invocation ends while it
 *    waits, so no Lambda compute is billed. The MicroVM completes the callback
 *    with its result or its failure.
 * 5. `<name>.terminate` calls TerminateMicrovm. It runs after success,
 *    failure, and timeout alike.
 *
 * Each durable operation records a subtype from
 * {@link MicrovmOperationSubType}: `Microvm` on the child context, and
 * `MicrovmCallback`, `MicrovmLaunch`, `MicrovmRequest`, and `MicrovmTerminate`
 * on the operations inside it.
 *
 * The operation sets no idle policy. The idle policy counts only inbound
 * traffic through the MicroVM endpoint. A job receives no inbound traffic
 * after its delivery. So an idle policy would suspend the MicroVM in the
 * middle of the job.
 *
 * A terminate failure does not fail the operation. The job result is already
 * recorded when terminate runs, and `maximumDurationInSeconds` bounds how long
 * the MicroVM can keep running. So the operation logs a warning and returns
 * the job's outcome.
 *
 * Pass the context that the call runs in, such as a child context or a
 * `map` item's context:
 * ```typescript
 * export const handler = withDurableExecution(async (event, context) =>
 *   microvm(context, "build", { repo }, config),
 * );
 * ```
 *
 * @param context - The context to create the durable operations in.
 * @param name - The child context name. It also prefixes the inner
 * operation names.
 * @param input - The job input. It must be JSON-serializable, and it must be
 * the same on every replay. Its size selects the delivery.
 * @param config - The MicroVM, delivery, and callback configuration.
 * @returns The value that the MicroVM passed to
 * `SendDurableExecutionCallbackSuccess`, parsed as JSON.
 * @throws \{TypeError\} When `name`, `imageIdentifier`, `executionRoleArn`, or
 * `request` is invalid.
 * @throws \{RangeError\} When `timeout` is not between 1 second and 8 hours,
 * or `request.retryWindow` is not between 1 second and 10 minutes.
 * @throws \{MicrovmLaunchError\} When `RunMicrovm` fails after all retries.
 * @throws \{MicrovmDeliveryError\} When HTTP delivery fails after all retries,
 * or the route rejects the job.
 * @throws \{MicrovmJobFailedError\} When the MicroVM reports a failure.
 * @throws \{MicrovmTimeoutError\} When no result or heartbeat arrives in time.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export function microvm<TOutput = unknown, TInput = unknown>(
  context: DurableContext,
  name: string,
  input: TInput,
  config: MicrovmConfig,
): DurablePromise<TOutput> {
  let timeoutSeconds: number;
  let scope: OperationScope;
  try {
    timeoutSeconds = validateBaseConfig(name, config);
    if (config.request !== undefined) {
      validateRequest(name, config.request);
    }
    scope = createScope(context, name, config);
  } catch (error) {
    return new DurablePromise<TOutput>(() => Promise.reject(error));
  }

  const request = config.request;

  return context.runInChildContext<TOutput>(
    name,
    async (child) => {
      const [result, callbackId] = await createJobCallback<TOutput>(
        child,
        name,
        config.timeout,
        config.heartbeatTimeout,
      );
      const job = jobDocument(callbackId, input, config.heartbeatTimeout);

      // The delivery depends on the payload size, and the payload contains
      // the callback ID. So the choice runs after createCallback. It is
      // deterministic: the callback ID comes from the checkpoint on replay,
      // and the input must be the same on every replay.
      const withJob = JSON.stringify({
        version: 1,
        region: scope.region,
        job,
      } satisfies MicrovmRunHookPayload<TInput>);
      const overHttp = request?.path !== undefined || !fitsRunHook(withJob);
      const runHookPayload = overHttp
        ? JSON.stringify({
            version: 1,
            region: scope.region,
          } satisfies MicrovmRunHookPayload<TInput>)
        : withJob;

      const launched = await inStage(name, "launch", () =>
        launch(child, scope, {
          tokenSource: callbackId,
          timeoutSeconds,
          defaultIngress: overHttp ? "ALL_INGRESS" : "NO_INGRESS",
          runHookPayload,
          needsEndpoint: overHttp,
        }),
      );

      try {
        if (overHttp) {
          await inStage(name, "delivery", () =>
            deliverJob(child, scope, name, launched, request ?? {}, job),
          );
        }
        return await inStage(name, "job", () => result);
      } finally {
        await terminate(child, scope, launched.microvmId);
      }
    },
    {
      subType: MicrovmOperationSubType.MICROVM,
      errorMapper: microvmErrorMapper(name),
    },
  );
}
