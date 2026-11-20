import {
  type ExecutionContext,
  OperationSubType,
  DurablePromise,
  OperationLifecycleState,
  type DistributedMapConfig,
  type DistributedMapProcessor,
  type DistributedMapSource,
  type DistributedMapSummary,
  type DistributedMapResult,
  type DistributedMapResultItem,
  DistributedMapStatus,
  DistributedMapItemStatus,
  assertCompletionConfig,
  assertDestination,
  assertProcessor,
  assertSource,
} from "../../types";
import {
  DistributedMapError,
  DistributedMapItemError,
} from "../../errors/durable-error/durable-error";
import {
  OperationAction,
  OperationStatus,
  OperationType,
  type DistributedMapOptions,
  type DistributedMapSourceOptions,
  type DistributedMapDestinationOptions,
  type DistributedMapCompletionOptions,
  type DistributedMapDetails,
} from "../../types/wire";
import { log } from "../../utils/logger/logger";
import type { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import {
  defaultSerdes,
  type AnySerdes,
  type SerdesContext,
} from "../../utils/serdes/serdes";
import { durationToSeconds } from "../../utils/duration/duration";
import {
  safeSerialize,
  safeDeserialize,
} from "../../errors/serdes-errors/serdes-errors";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import type { DurableInstrumentationPlugin } from "../../types/plugin";
import {
  backfillOperationInfo,
  toOperationInfo,
} from "../../utils/operation/operation";
import { hashId } from "../../utils/step-id-utils/step-id-utils";
import type { TerminationManager } from "../../termination-manager/termination-manager";
import { TerminationReason } from "../../termination-manager/types";
import {
  DistributedMapResultImpl,
  DistributedMapSummaryImpl,
} from "./distributed-map-result";
import {
  dmapSerdesContext,
  parseDistributedMapRunArn,
} from "./distributed-map-serdes-context";

type AnyDistributedMapConfig = DistributedMapConfig<unknown>;

const INLINE_SIZE_LIMIT = 1024 * 1024;
const READER_STATE_LIMIT = 32 * 1024;
const MAX_TIMEOUT_SECONDS = 7776000; // 90 days

/**
 * Terminates the execution for an invalid configuration value. An invalid value is a
 * deterministic, non-retryable configuration error: terminating rather than throwing means a
 * misconfigured call fails cleanly instead of being retried by Lambda only to fail identically
 * again. Mirrors the map and parallel handler's treatment of the same error class.
 */
function terminateForConfig(
  message: string,
  terminationManager: TerminationManager,
): false {
  terminationManager.terminate({
    reason: TerminationReason.CONFIG_VALIDATION_ERROR,
    message,
    error: new Error(message),
  });
  return false;
}

/** Terminates for an invalid configuration value found after an await, then never settles. */
function terminateForConfigAsync(
  message: string,
  terminationManager: TerminationManager,
): Promise<never> {
  terminateForConfig(message, terminationManager);
  return new Promise<never>(() => {});
}

/**
 * Returns the serialized value. The wire needs a string, so a serdes that produced no string
 * is an invalid configuration, and the execution terminates like any other config error.
 */
async function requireSerialized(
  serialized: string | undefined,
  label: string,
  terminationManager: TerminationManager,
): Promise<string> {
  if (typeof serialized === "string") return serialized;
  return terminateForConfigAsync(
    `Serialization of ${label} produced no string`,
    terminationManager,
  );
}

/** Returns true when seconds is a whole number in (0, max]. */
function isValidSeconds(seconds: number, max: number): boolean {
  return Number.isInteger(seconds) && seconds > 0 && seconds <= max;
}

/**
 * Validates the call-site configuration. Returns `true` when the config is valid, or `false`
 * when it terminated the execution (the caller must then stop).
 */
function validateConfig(
  source: unknown,
  processor: unknown,
  maxConcurrency: number,
  config: AnyDistributedMapConfig | undefined,
  terminationManager: TerminationManager,
): boolean {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    return terminateForConfig(
      `Invalid maxConcurrency: ${maxConcurrency}. Must be an integer greater than zero.`,
      terminationManager,
    );
  }
  try {
    assertSource(source);
    assertProcessor(processor);
    assertDestination(config?.destination);
    assertCompletionConfig(config?.completionConfig);
  } catch (error) {
    return terminateForConfig((error as Error).message, terminationManager);
  }
  if (config?.timeout) {
    const seconds = durationToSeconds(config.timeout);
    if (!isValidSeconds(seconds, MAX_TIMEOUT_SECONDS)) {
      return terminateForConfig(
        `Invalid timeout: ${seconds} seconds. Must be a whole number of seconds, positive and at most 90 days.`,
        terminationManager,
      );
    }
  }
  return true;
}

/** PENDING and STARTED mean the service has not finished the run. Every other status is final. */
function isRunning(status: OperationStatus | undefined): boolean {
  return (
    status === OperationStatus.PENDING || status === OperationStatus.STARTED
  );
}

async function serializeInlineItems(
  items: unknown[],
  serdes: AnySerdes,
  stepId: string,
  name: string | undefined,
  context: ExecutionContext,
): Promise<string[]> {
  // Copy the items before the first await, so items the caller adds during serialization are not sent.
  const snapshot = items.slice();
  const wireItems: string[] = [];
  for (const [index, item] of snapshot.entries()) {
    // Each item gets its own context. The entity id has the form the JS SDK uses for child step ids.
    const serdesContext: SerdesContext = {
      entityId: `${stepId}-${index + 1}`,
      durableExecutionArn: context.durableExecutionArn,
    };
    const serialized = await safeSerialize(
      { serialize: (value) => serdes.serialize(value, serdesContext) },
      item,
      stepId,
      name,
      context.terminationManager,
      context.durableExecutionArn,
    );
    wireItems.push(
      await requireSerialized(
        serialized,
        `inline item ${index}`,
        context.terminationManager,
      ),
    );
  }
  const total = Buffer.byteLength(JSON.stringify(wireItems), "utf8");
  if (total > INLINE_SIZE_LIMIT) {
    return terminateForConfigAsync(
      `inline source exceeds the 1 MB limit (serialized size: ${total} bytes)`,
      context.terminationManager,
    );
  }
  return wireItems;
}

async function toDistributedMapSourceOptions(
  source: DistributedMapSource<unknown> | unknown[],
  defaultS: AnySerdes,
  stepId: string,
  name: string | undefined,
  context: ExecutionContext,
): Promise<DistributedMapSourceOptions> {
  if (Array.isArray(source)) {
    return {
      Type: "INLINE",
      InlineSourceConfig: {
        Items: await serializeInlineItems(
          source,
          defaultS,
          stepId,
          name,
          context,
        ),
      },
    };
  }
  const def = source.definition;
  if (def.type === "INLINE") {
    return {
      Type: "INLINE",
      MaxItemsToRead: def.maxItems,
      InlineSourceConfig: {
        Items: await serializeInlineItems(
          def.items,
          def.serdes ?? defaultS,
          stepId,
          name,
          context,
        ),
      },
    };
  }
  if (def.type === "S3") {
    return {
      Type: "S3",
      MaxItemsToRead: def.maxItems,
      S3SourceConfig: { ...def.s3 },
    };
  }
  const readerConfig: NonNullable<
    DistributedMapSourceOptions["ReaderFunctionSourceConfig"]
  > = {
    FunctionName: def.functionName,
  };
  if (def.initialState !== undefined && def.initialState !== null) {
    const state = await requireSerialized(
      await safeSerialize(
        def.stateSerdes ?? defaultS,
        def.initialState,
        stepId,
        name,
        context.terminationManager,
        context.durableExecutionArn,
      ),
      "reader initialState",
      context.terminationManager,
    );
    if (Buffer.byteLength(state, "utf8") > READER_STATE_LIMIT) {
      return terminateForConfigAsync(
        "reader initialState exceeds the 32 KB limit",
        context.terminationManager,
      );
    }
    readerConfig.InitialState = state;
  }
  return {
    Type: "READER_FUNCTION",
    MaxItemsToRead: def.maxItems,
    ReaderFunctionSourceConfig: readerConfig,
  };
}

/** @internal */
export function toDistributedMapDestinationOptions(
  config: AnyDistributedMapConfig,
): DistributedMapDestinationOptions | undefined {
  const dest = config.destination;
  if (!dest?.onSuccess && !dest?.onFailure) return undefined;
  return {
    ...(dest.onSuccess ? { OnSuccess: dest.onSuccess.options } : {}),
    ...(dest.onFailure ? { OnFailure: dest.onFailure.options } : {}),
  };
}

async function buildOptions(
  source: DistributedMapSource<unknown> | unknown[],
  processor: DistributedMapProcessor<unknown>,
  maxConcurrency: number,
  config: AnyDistributedMapConfig,
  defaultS: AnySerdes,
  stepId: string,
  name: string | undefined,
  context: ExecutionContext,
): Promise<DistributedMapOptions> {
  // Read every argument before the source serialization await, so the request reflects one point in time.
  const completion = config.completionConfig;
  const destination = toDistributedMapDestinationOptions(config);
  const processorOptions = { ...processor.options };
  const collectResults = config.collectResults === true;
  const timeoutSeconds = config.timeout
    ? durationToSeconds(config.timeout)
    : undefined;
  const completionWire: DistributedMapCompletionOptions = {};
  if (completion) {
    if (
      "toleratedFailureCount" in completion &&
      completion.toleratedFailureCount !== undefined
    ) {
      completionWire.ToleratedFailureCount = completion.toleratedFailureCount;
    }
    if (
      "toleratedFailurePercentage" in completion &&
      completion.toleratedFailurePercentage !== undefined
    ) {
      completionWire.ToleratedFailurePercentage =
        completion.toleratedFailurePercentage;
    }
    if (
      "minimumSampleSize" in completion &&
      completion.minimumSampleSize !== undefined
    ) {
      completionWire.MinimumSampleSize = completion.minimumSampleSize;
    }
  }
  return {
    MaxConcurrency: maxConcurrency,
    Source: await toDistributedMapSourceOptions(
      source,
      defaultS,
      stepId,
      name,
      context,
    ),
    Processor: processorOptions,
    ...(destination ? { Destination: destination } : {}),
    ...(Object.keys(completionWire).length > 0
      ? { CompletionConfig: completionWire }
      : {}),
    ...(collectResults ? { ResultCollection: { Mode: "INLINE" } } : {}),
    ...(timeoutSeconds !== undefined ? { TimeoutSeconds: timeoutSeconds } : {}),
  };
}

const DISTRIBUTED_MAP_STATUS_SET: ReadonlySet<string> = new Set(
  Object.values(DistributedMapStatus),
);

function parseStatus(value: string | undefined): DistributedMapStatus {
  if (value === undefined) {
    throw new DistributedMapError(
      "missing distributed map status from backend",
    );
  }
  if (DISTRIBUTED_MAP_STATUS_SET.has(value)) {
    return value as DistributedMapStatus;
  }
  // Unrecognized status from backend, don't throw.
  return DistributedMapStatus.UNKNOWN_TO_SDK_VERSION;
}

function parseItemStatus(value: string | undefined): DistributedMapItemStatus {
  if (value === undefined) {
    throw new DistributedMapError(
      "missing distributed map item status from backend",
    );
  }
  if (
    value === DistributedMapItemStatus.SUCCEEDED ||
    value === DistributedMapItemStatus.FAILED
  ) {
    return value;
  }
  // Unrecognized status from backend, don't throw.
  return DistributedMapItemStatus.UNKNOWN_TO_SDK_VERSION;
}

/** Returns a result's item ID, or throws when the service omitted it. */
function requireItemId(value: string | undefined): string {
  if (value === undefined) {
    throw new DistributedMapError(
      "missing distributed map item id from backend",
    );
  }
  return value;
}

/** Returns a count the service must send at terminal, or throws when it is missing. */
function requireCount(value: number | undefined, field: string): number {
  if (value === undefined || value === null) {
    throw new DistributedMapError(
      `missing distributed map ${field} from backend`,
    );
  }
  return value;
}

/** @internal */
export async function buildSummary(
  details: DistributedMapDetails,
  config: AnyDistributedMapConfig,
  stepId: string,
  name: string | undefined,
  context: ExecutionContext,
  defaultS: AnySerdes,
  operationStatus: string | undefined,
): Promise<DistributedMapSummary> {
  // The run status is the operation's own terminal status; details does not carry it.
  const status = parseStatus(operationStatus);
  const arn = details.DistributedMapRunArn;
  const runError = details.Error;
  // SourceExhausted is required at terminal once the run exists. It is absent only when the
  // operation failed before a run was created, which is also when the run ARN is absent.
  if (arn !== undefined && details.SourceExhausted === undefined) {
    throw new DistributedMapError(
      "missing distributed map SourceExhausted from backend",
    );
  }
  // The counts are required at every terminal state, and TotalCount is required for SUCCEEDED.
  // A missing count would otherwise read as zero, so a missing FailureCount would hide failed items.
  const successCount = requireCount(details.SuccessCount, "SuccessCount");
  const failureCount = requireCount(details.FailureCount, "FailureCount");
  const readCount = requireCount(details.ReadCount, "ReadCount");
  if (
    status === DistributedMapStatus.SUCCEEDED &&
    details.TotalCount === undefined
  ) {
    throw new DistributedMapError(
      "missing distributed map TotalCount from backend",
    );
  }

  const fields = {
    distributedMapRunArn: arn,
    status,
    sourceExhausted: details.SourceExhausted,
    error: runError,
    successCount,
    failureCount,
    readCount,
    totalCount: details.TotalCount,
  };

  if (config.collectResults !== true) {
    return new DistributedMapSummaryImpl(fields);
  }

  const all: Array<DistributedMapResultItem<unknown>> = [];
  for (const wire of details.Results ?? []) {
    const itemId = requireItemId(wire.ItemId);
    let result: unknown;
    if (wire.Output !== undefined && wire.Output !== null) {
      // The processor wrote the output with a context built from the run ARN and the item id.
      if (arn === undefined || !parseDistributedMapRunArn(arn)) {
        throw new DistributedMapError(
          "missing or invalid distributed map run ARN from backend",
        );
      }
      const serdesContext = dmapSerdesContext(arn, "output", itemId);
      const resultSerdes = config.resultSerdes ?? defaultS;
      result = await safeDeserialize(
        {
          deserialize: (data) => resultSerdes.deserialize(data, serdesContext),
        },
        wire.Output,
        stepId,
        name,
        context.terminationManager,
        context.durableExecutionArn,
      );
    }
    let error: DistributedMapItemError | undefined;
    if (wire.Error) {
      error = DistributedMapItemError.fromItemErrorObject(wire.Error);
    }
    all.push({
      itemId,
      status: parseItemStatus(wire.Status),
      result,
      error,
    });
  }

  return new DistributedMapResultImpl(fields, all);
}

export const createDistributedMapHandler = (
  context: ExecutionContext,
  checkpoint: Checkpoint,
  createStepId: () => string,
  parentId?: string,
  checkAndUpdateReplayMode?: () => void,
  getDefaultSerdes?: () => AnySerdes,
  plugin: DurableInstrumentationPlugin = {},
): {
  <TItem, TOutput>(
    source: DistributedMapSource<TItem> | TItem[],
    processor: DistributedMapProcessor<TOutput>,
    maxConcurrency: number,
    config: DistributedMapConfig<TOutput> & { collectResults: true },
  ): DurablePromise<DistributedMapResult<TOutput>>;
  <TItem, TOutput>(
    name: string | undefined,
    source: DistributedMapSource<TItem> | TItem[],
    processor: DistributedMapProcessor<TOutput>,
    maxConcurrency: number,
    config: DistributedMapConfig<TOutput> & { collectResults: true },
  ): DurablePromise<DistributedMapResult<TOutput>>;
  <TItem, TOutput>(
    source: DistributedMapSource<TItem> | TItem[],
    processor: DistributedMapProcessor<TOutput>,
    maxConcurrency: number,
    config?: DistributedMapConfig<TOutput>,
  ): DurablePromise<DistributedMapSummary>;
  <TItem, TOutput>(
    name: string | undefined,
    source: DistributedMapSource<TItem> | TItem[],
    processor: DistributedMapProcessor<TOutput>,
    maxConcurrency: number,
    config?: DistributedMapConfig<TOutput>,
  ): DurablePromise<DistributedMapSummary>;
} => {
  function distributedMapHandler<TItem, TOutput>(
    arg0: string | undefined | DistributedMapSource<TItem> | TItem[],
    arg1:
      | DistributedMapSource<TItem>
      | TItem[]
      | DistributedMapProcessor<TOutput>,
    arg2: DistributedMapProcessor<TOutput> | number,
    arg3?: number | AnyDistributedMapConfig,
    arg4?: AnyDistributedMapConfig,
  ): DurablePromise<DistributedMapSummary | DistributedMapResult<TOutput>> {
    const isNameFirst = typeof arg0 === "string" || arg0 === undefined;
    const name = isNameFirst ? (arg0 as string | undefined) : undefined;
    const source = (isNameFirst ? arg1 : arg0) as
      | DistributedMapSource<TItem>
      | TItem[];
    const processor = (
      isNameFirst ? arg2 : arg1
    ) as DistributedMapProcessor<TOutput>;
    const maxConcurrency = (isNameFirst ? arg3 : arg2) as number;
    const config = (isNameFirst ? arg4 : arg3) as
      | AnyDistributedMapConfig
      | undefined;

    const resolvedConfig: AnyDistributedMapConfig = config ?? {};
    const defaultS = getDefaultSerdes ? getDefaultSerdes() : defaultSerdes;
    const stepId = createStepId();

    const opInfo = {
      id: hashId(stepId),
      name,
      type: OperationType.DISTRIBUTED_MAP,
      subType: OperationSubType.DISTRIBUTED_MAP,
      parentId: parentId ? hashId(parentId) : undefined,
    };

    const metadata = {
      stepId,
      name,
      type: OperationType.DISTRIBUTED_MAP,
      subType: OperationSubType.DISTRIBUTED_MAP,
      parentId,
    };

    let isCompleted = false;

    // Both terminal paths end the operation the same way.
    const completeOperation = async (isReplay: boolean): Promise<void> => {
      checkAndUpdateReplayMode?.();
      checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED, {
        metadata,
      });
      const stepData = context.getStepData(stepId);
      const operationInfo = toOperationInfo(stepData);
      backfillOperationInfo(operationInfo, opInfo);
      const error =
        stepData?.Status === OperationStatus.SUCCEEDED
          ? undefined
          : DistributedMapError.fromRunErrorObject(
              stepData?.Status,
              stepData?.DistributedMapDetails?.Error,
            );
      await plugin.onOperationEnd?.({
        ...operationInfo,
        isReplay,
        ...(error ? { error } : {}),
      });
    };

    const phase1Promise = (async (): Promise<void> => {
      log("🗺️", "Distributed map phase 1:", { stepId, name });

      let stepData = context.getStepData(stepId);

      validateReplayConsistency(
        stepId,
        {
          type: OperationType.DISTRIBUTED_MAP,
          name,
          subType: OperationSubType.DISTRIBUTED_MAP,
        },
        stepData,
        context,
      );

      // A recorded operation that is not running is final, and carries the run outcome in DistributedMapDetails.
      if (stepData && !isRunning(stepData.Status)) {
        await completeOperation(
          !context.isOperationUpdatedBetweenInvocation(opInfo.id),
        );
        isCompleted = true;
        return;
      }

      if (!stepData) {
        // An invalid config terminates the execution rather than throwing. If it terminated, stop
        // here with a never-settling promise so we don't proceed.
        if (
          !validateConfig(
            source,
            processor,
            maxConcurrency,
            resolvedConfig,
            context.terminationManager,
          )
        ) {
          return new Promise<never>(() => {});
        }
        const options = await buildOptions(
          source as DistributedMapSource<unknown> | unknown[],
          processor,
          maxConcurrency,
          resolvedConfig,
          defaultS,
          stepId,
          name,
          context,
        );
        await checkpoint.checkpoint(stepId, {
          Id: stepId,
          ParentId: parentId,
          Action: OperationAction.START,
          SubType: OperationSubType.DISTRIBUTED_MAP,
          Type: OperationType.DISTRIBUTED_MAP,
          Name: name,
          DistributedMapOptions: options,
        });
        stepData = context.getStepData(stepId);
        const operationInfo = toOperationInfo(stepData);
        backfillOperationInfo(operationInfo, opInfo);
        await plugin.onOperationStart?.({ ...operationInfo, isReplay: false });
      } else {
        const operationInfo = toOperationInfo(stepData);
        backfillOperationInfo(operationInfo, opInfo);
        await plugin.onOperationStart?.({ ...operationInfo, isReplay: true });
      }

      checkpoint.markOperationState(
        stepId,
        OperationLifecycleState.IDLE_NOT_AWAITED,
        { metadata },
      );

      log("✅", "Distributed map phase 1 complete:", { stepId });
    })();

    phase1Promise.catch(() => {});

    return new DurablePromise(async () => {
      await phase1Promise;

      if (!isCompleted) {
        log("🗺️", "Distributed map phase 2:", { stepId });
        checkpoint.markOperationAwaited(stepId);
        // A waiter resolves on any status change, including PENDING to STARTED. So wait again
        // until the run is finished.
        do {
          await checkpoint.waitForStatusChange(stepId);
        } while (isRunning(context.getStepData(stepId)?.Status));
        await completeOperation(false);
      }

      const stepData = context.getStepData(stepId);
      // Every terminal state resolves with the summary, matching map and parallel.
      // throwIfError() is how a caller opts into raising.
      const details = stepData?.DistributedMapDetails;
      if (!details) {
        throw new DistributedMapError(
          `DISTRIBUTED_MAP operation ended ${stepData?.Status ?? "UNKNOWN"} but carried no DistributedMapDetails`,
        );
      }
      return (await buildSummary(
        details,
        resolvedConfig,
        stepId,
        name,
        context,
        defaultS,
        stepData?.Status,
      )) as DistributedMapSummary | DistributedMapResult<TOutput>;
    });
  }

  // The overloads pick the return type from `collectResults`, which the single implementation signature cannot express.
  return distributedMapHandler as ReturnType<
    typeof createDistributedMapHandler
  >;
};
