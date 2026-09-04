import {
  ExecutionContext,
  FetchConfig,
  FetchResponse,
  OperationSubType,
  DurablePromise,
  OperationLifecycleState,
} from "../../types";
import { FetchError } from "../../errors/durable-error/durable-error";
import { Operation, OperationStatus, OperationType } from "../../types/wire";
import { OperationAction } from "../../types/wire";
import { log } from "../../utils/logger/logger";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { durationToSeconds } from "../../utils/duration/duration";
import { validateReplayConsistency } from "../../utils/replay-validation/replay-validation";
import { DurableInstrumentationPlugin } from "../../types/plugin";
import {
  backfillOperationInfo,
  toOperationInfo,
} from "../../utils/operation/operation";
import { hashId } from "../../utils/step-id-utils/step-id-utils";

/**
 * Statuses that mean the service has finished with the operation but no HTTP exchange was
 * recorded. `TIMED_OUT` belongs here rather than with the successful responses: a timeout
 * means no response arrived, which is a transport failure.
 */
const TERMINAL_FAILURE_STATUSES: readonly (OperationStatus | undefined)[] = [
  OperationStatus.FAILED,
  OperationStatus.TIMED_OUT,
  OperationStatus.STOPPED,
];

/**
 * Builds the caller-facing response from the details the service recorded.
 *
 * Any completed exchange resolves, whatever the status code, so this is reached for a 500
 * exactly as it is for a 200. Reaching it without a `StatusCode` means the service reported
 * `SUCCEEDED` for an operation it did not record a response against, which is a contract
 * violation rather than a workflow-level failure.
 */
const toFetchResponse = (operation: Operation | undefined): FetchResponse => {
  const details = operation?.FetchDetails;

  if (details?.StatusCode === undefined) {
    throw new FetchError(
      "Fetch succeeded without recording a response status code",
    );
  }

  return {
    status: details.StatusCode,
    ok: details.StatusCode >= 200 && details.StatusCode < 300,
    headers: details.Headers ?? {},
    body: details.Result ?? "",
  };
};

/**
 * Converts a non-response outcome into the error the caller sees.
 */
const toFetchError = (operation: Operation | undefined): FetchError => {
  const error = operation?.FetchDetails?.Error;

  if (!error) {
    return new FetchError(
      `Fetch failed with status ${operation?.Status ?? "UNKNOWN"}`,
    );
  }

  return new FetchError(
    error.ErrorMessage || "Fetch failed",
    error.ErrorMessage ? new Error(error.ErrorMessage) : undefined,
    error.ErrorData,
  );
};

export const createFetchHandler = (
  context: ExecutionContext,
  checkpoint: Checkpoint,
  createStepId: () => string,
  parentId?: string,
  checkAndUpdateReplayMode?: () => void,
  plugin: DurableInstrumentationPlugin = {},
): {
  (url: string, config?: FetchConfig): DurablePromise<FetchResponse>;
  (
    name: string,
    url: string,
    config?: FetchConfig,
  ): DurablePromise<FetchResponse>;
} => {
  function fetchHandler(
    url: string,
    config?: FetchConfig,
  ): DurablePromise<FetchResponse>;
  function fetchHandler(
    name: string,
    url: string,
    config?: FetchConfig,
  ): DurablePromise<FetchResponse>;
  function fetchHandler(
    nameOrUrl: string,
    urlOrConfig?: string | FetchConfig,
    maybeConfig?: FetchConfig,
  ): DurablePromise<FetchResponse> {
    const isNameFirst = typeof urlOrConfig === "string";
    const name = isNameFirst ? nameOrUrl : undefined;
    const url = isNameFirst ? urlOrConfig : nameOrUrl;
    const config = isNameFirst
      ? maybeConfig
      : (urlOrConfig as FetchConfig | undefined);

    const stepId = createStepId();

    const opInfo = {
      id: hashId(stepId),
      name: name,
      type: OperationType.FETCH,
      subType: OperationSubType.FETCH,
      parentId: parentId ? hashId(parentId) : undefined,
    };

    /**
     * Emits `onOperationEnd` for an operation that was already terminal when this
     * invocation started, so a replay reports the same lifecycle a first run does.
     */
    const reportReplayedEnd = async (
      stepData: Operation | undefined,
      error?: Error,
    ): Promise<void> => {
      const operationInfo = toOperationInfo(stepData);
      backfillOperationInfo(operationInfo, opInfo);
      const isUpdatedBetweenInvocation =
        context.isOperationUpdatedBetweenInvocation(opInfo.id);
      await plugin.onOperationEnd?.({
        ...operationInfo,
        isReplay: !isUpdatedBetweenInvocation,
        ...(error ? { error } : {}),
      });
    };

    // Phase 1: start the fetch, or recognize that it already finished.
    let isCompleted = false;

    const phase1Promise = (async (): Promise<void> => {
      log("🌐", "Fetch phase 1:", { stepId, name: name || url });

      let stepData = context.getStepData(stepId);

      validateReplayConsistency(
        stepId,
        {
          type: OperationType.FETCH,
          name,
          subType: OperationSubType.FETCH,
        },
        stepData,
        context,
      );

      const isTerminal =
        stepData?.Status === OperationStatus.SUCCEEDED ||
        TERMINAL_FAILURE_STATUSES.includes(stepData?.Status);

      if (isTerminal) {
        log("⏭️", "Fetch already completed:", {
          stepId,
          status: stepData?.Status,
        });
        checkAndUpdateReplayMode?.();

        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
          {
            metadata: {
              stepId,
              name,
              type: OperationType.FETCH,
              subType: OperationSubType.FETCH,
              parentId,
            },
          },
        );

        await reportReplayedEnd(
          stepData,
          stepData?.Status === OperationStatus.SUCCEEDED
            ? undefined
            : toFetchError(stepData),
        );

        isCompleted = true;
        return;
      }

      // Start the fetch if the service has not recorded it yet. The request body travels
      // as the operation payload, mirroring how a chained invoke carries its input.
      if (!stepData) {
        await checkpoint.checkpoint(stepId, {
          Id: stepId,
          ParentId: parentId,
          Action: OperationAction.START,
          SubType: OperationSubType.FETCH,
          Type: OperationType.FETCH,
          Name: name,
          Payload: config?.body,
          FetchOptions: {
            Url: url,
            ...(config?.method && { Method: config.method }),
            ...(config?.headers && { Headers: config.headers }),
            ...(config?.timeout && {
              TimeoutSeconds: durationToSeconds(config.timeout),
            }),
          },
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
        {
          metadata: {
            stepId,
            name,
            type: OperationType.FETCH,
            subType: OperationSubType.FETCH,
            parentId,
          },
        },
      );

      log("✅", "Fetch phase 1 complete:", { stepId });
    })();

    phase1Promise.catch(() => {});

    // Phase 2: suspend until the service records an outcome.
    return new DurablePromise(async () => {
      await phase1Promise;

      if (isCompleted) {
        const stepData = context.getStepData(stepId);

        if (stepData?.Status === OperationStatus.SUCCEEDED) {
          return toFetchResponse(stepData);
        }

        throw toFetchError(stepData);
      }

      log("🌐", "Fetch phase 2:", { stepId });

      checkpoint.markOperationAwaited(stepId);

      await checkpoint.waitForStatusChange(stepId);

      const stepData = context.getStepData(stepId);

      checkAndUpdateReplayMode?.();
      checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED);

      const operationInfo = toOperationInfo(stepData);
      backfillOperationInfo(operationInfo, opInfo);

      if (stepData?.Status === OperationStatus.SUCCEEDED) {
        log("✅", "Fetch completed:", {
          stepId,
          statusCode: stepData.FetchDetails?.StatusCode,
        });

        await plugin.onOperationEnd?.({ ...operationInfo, isReplay: false });

        return toFetchResponse(stepData);
      }

      log("❌", "Fetch failed:", { stepId, status: stepData?.Status });

      const fetchError = toFetchError(stepData);
      await plugin.onOperationEnd?.({
        ...operationInfo,
        isReplay: false,
        error: fetchError,
      });

      throw fetchError;
    });
  }

  return fetchHandler;
};
