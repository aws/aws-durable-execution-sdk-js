import {
  ExecutionStatus,
  Operation,
  OperationStatus,
} from "@aws-sdk/client-lambda";
import {
  withDurableFunctions,
  InvocationStatus,
} from "aws-durable-execution-sdk-js";
import { InvocationResult } from "../../checkpoint-server/storage/execution-manager";
import {
  CheckpointToken,
  ExecutionId,
  InvocationId,
} from "../../checkpoint-server/utils/tagged-strings";
import { InvokeHandler } from "./invoke-handler";
import { LocalOperationStorage } from "./operations/local-operation-storage";
import { InvocationTracker } from "./operations/invocation-tracker";
import {
  TestExecutionResult,
  TestExecutionState,
} from "./test-execution-state";
import { InvokeRequest, Invocation } from "../durable-test-runner";
import {
  OperationAction,
  OperationType,
  OperationUpdate,
} from "@aws-sdk/client-lambda";
import { CheckpointApiClient } from "./api-client/checkpoint-api-client";
import {
  CheckpointOperation,
  OperationInvocationIdMap,
} from "../../checkpoint-server/storage/checkpoint-manager";
import { Scheduler } from "./orchestration/scheduler";

/**
 * Orchestrates test execution lifecycle, polling, and handler invocation for LocalDurableTestRunner.
 * Manages the coordination between checkpoint polling, operation processing, and handler execution.
 */
export class TestExecutionOrchestrator {
  private executionState: TestExecutionState = new TestExecutionState();
  private invokeHandlerInstance: InvokeHandler = new InvokeHandler();
  private invocationTracker: InvocationTracker;

  constructor(
    private handlerFunction: ReturnType<typeof withDurableFunctions>,
    private operationStorage: LocalOperationStorage,
    private readonly checkpointApi: CheckpointApiClient,
    private readonly scheduler: Scheduler,
    private skipTime = false
  ) {
    this.executionState = new TestExecutionState();
    this.invocationTracker = new InvocationTracker(operationStorage);
  }

  /**
   * Gets the list of all invocations that have been tracked during execution.
   *
   * @returns Array of invocation records
   */
  getInvocations(): Invocation[] {
    return this.invocationTracker.getInvocations();
  }

  /**
   * Executes the durable function handler and returns the result.
   * The method will not resolve until the handler function completes successfully
   * or throws an error.
   *
   * @param params Optional parameters for the execution
   * @returns Promise that resolves with the execution result
   */
  async executeHandler(params?: InvokeRequest): Promise<TestExecutionResult> {
    // Reset invocations tracking when starting a new execution
    this.invocationTracker.reset();

    process.env.DURABLE_LOCAL_MODE = "true";
    process.env.DEX_ENDPOINT = this.checkpointApi.getServerUrl();

    // Abort controller aborts polling when any invocation returns with 'SUCCEEDED/FAILED'
    const abortController = new AbortController();

    try {
      const {
        executionId,
        operations: initialOperations,
        checkpointToken,
        invocationId,
      }: InvocationResult = await this.checkpointApi.startDurableExecution(
        JSON.stringify(params?.payload)
      );

      this.operationStorage.registerMocks(executionId);

      // Start polling for checkpoint data before invoking the handler
      void this.pollForCheckpointData(abortController, executionId);

      // Start initial invocation of the handler
      void this.invokeHandler(
        executionId,
        checkpointToken,
        invocationId,
        initialOperations
      );

      // Wait for entire execution to complete
      return await this.executionState.createExecutionPromise();
    } finally {
      // Stop polling
      await new Promise<void>((resolve) => {
        // TODO: improve the polling mechanism so that we don't need an arbitrary timer
        setTimeout(() => {
          abortController.abort();
          resolve();
        }, 100);
      });
    }
  }

  /**
   * Continuously polls checkpoint data until execution reaches completion.
   *
   * This method runs in a loop, repeatedly checking for new operations
   * and processing them. The loop continues until the execution is
   * signaled as complete via the abort controller.
   *
   * @param abortController Aborted when execution completes
   * @param executionId The execution to monitor
   */
  private async pollForCheckpointData(
    abortController: AbortController,
    executionId: ExecutionId
  ): Promise<void> {
    try {
      while (!abortController.signal.aborted) {
        const { operations, operationInvocationIdMap } =
          await this.checkpointApi.pollCheckpointData(
            executionId,
            abortController.signal
          );

        this.operationStorage.populateOperations(operations);

        this.processOperations(
          operations,
          executionId,
          operationInvocationIdMap
        );

        // Yield to event loop if `pollCheckpointData` returns too often (mainly in unit tests).
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (err: unknown) {
      // Only reject execution when the error is not an abort error
      if (
        !(
          err &&
          typeof err === "object" &&
          "name" in err &&
          err.name === "AbortError"
        )
      ) {
        this.executionState.rejectWith(err);
      }
    }
  }

  /**
   * Processes a batch of operations from checkpoint polling.
   *
   * @param operations Array of operations with their updates to process
   * @param executionId The current execution ID
   */
  private processOperations(
    operations: CheckpointOperation[],
    executionId: ExecutionId,
    operationInvocationIdMap: OperationInvocationIdMap = {}
  ): void {
    for (const { update, operation } of operations) {
      if (!operation.Id) {
        throw new Error("Could not process operation without an Id");
      }

      // Use invocation ID from map if available, otherwise throw an error
      const invocationIdList = operationInvocationIdMap[operation.Id];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!invocationIdList) {
        throw new Error(
          `Could not find invocations for operation ${operation.Id}`
        );
      }

      this.processOperation(
        update,
        operation,
        executionId,
        Array.from(invocationIdList)
      );
    }
  }

  /**
   * Processes a single operation based on its type.
   *
   * @param update The operation update containing processing instructions
   * @param operation The operation being processed
   * @param executionId The current execution ID
   */
  private processOperation(
    update: OperationUpdate | undefined,
    operation: Operation,
    executionId: ExecutionId,
    invocationIds: InvocationId[]
  ): void {
    if (!operation.Id) {
      throw new Error("Could not process operation without an Id");
    }

    this.invocationTracker.associateOperation(invocationIds, operation.Id);

    switch (operation.Type) {
      case OperationType.WAIT:
        this.handleWaitUpdate(update, operation, executionId);
        break;
      case OperationType.STEP:
        this.handleStepUpdate(update, operation, executionId);
        break;
      case OperationType.CALLBACK:
        // todo: handle errors
        void this.handleCallbackUpdate(operation, executionId);
        break;
      case OperationType.EXECUTION:
        this.handleExecutionUpdate(update, operation);
        break;
    }
  }

  /**
   * Processes a WAIT operation by scheduling the next invocation after the specified delay.
   *
   * The delay duration depends on the skipTime setting:
   * - If skipTime is false: uses the actual wait time specified in waitSeconds
   * - If skipTime is true: uses a minimal delay (1ms) for faster execution
   *
   * @param update The WAIT operation update containing timing information
   * @param operation The operation being processed
   * @param executionId The current execution ID
   */
  private handleWaitUpdate(
    update: OperationUpdate | undefined,
    operation: Operation,
    executionId: ExecutionId
  ): void {
    if (update?.Action !== OperationAction.START) {
      return;
    }

    const waitSeconds = update.WaitOptions?.WaitSeconds;

    if (!waitSeconds) {
      throw new Error("Wait operation is missing waitSeconds");
    }

    const operationId = operation.Id;

    if (!operationId) {
      throw new Error("Missing operation id");
    }

    this.scheduleAsyncFunction(waitSeconds, async () => {
      await this.checkpointApi.updateCheckpointData({
        executionId,
        operationId,
        status: OperationStatus.SUCCEEDED,
      });
      const newInvocationData =
        await this.checkpointApi.startInvocation(executionId);
      // Re-invoke handler after waitSeconds
      await this.invokeHandler(
        executionId,
        newInvocationData.checkpointToken,
        newInvocationData.invocationId,
        newInvocationData.operations
      );
    });
  }

  /**
   * Processes a STEP operation, handling retries if needed.
   * Step operations only update checkpoint data and do not re-invoke the handler.
   *
   * @param update The STEP operation update
   * @param operation The operation being processed
   * @param executionId The current execution ID
   */
  private handleStepUpdate(
    update: OperationUpdate | undefined,
    operation: Operation,
    executionId: ExecutionId
  ): void {
    if (update?.Action === OperationAction.RETRY) {
      const retryDelaySeconds = update.StepOptions?.NextAttemptDelaySeconds;

      if (!retryDelaySeconds) {
        throw new Error(
          "Step operation with retry is missing NextAttemptDelaySeconds"
        );
      }

      const operationId = operation.Id;

      if (!operationId) {
        throw new Error("Missing operation id");
      }

      this.scheduleAsyncFunction(
        retryDelaySeconds,
        async () => {
          const newInvocationData =
            await this.checkpointApi.startInvocation(executionId);
          return this.invokeHandler(
            executionId,
            newInvocationData.checkpointToken,
            newInvocationData.invocationId,
            newInvocationData.operations
          );
        },
        async () => {
          await this.checkpointApi.updateCheckpointData({
            executionId,
            operationId,
            status: OperationStatus.READY,
          });
        }
      );
    }
  }

  private async handleCallbackUpdate(
    operation: Operation,
    executionId: ExecutionId
  ): Promise<void> {
    if (operation.Status === OperationStatus.STARTED) {
      return;
    }

    if (this.invocationTracker.hasActiveInvocation()) {
      console.warn(
        "Skipping scheduled function execution due to current active invocation"
      );
      return;
    }

    const newInvocationData =
      await this.checkpointApi.startInvocation(executionId);
    await this.invokeHandler(
      executionId,
      newInvocationData.checkpointToken,
      newInvocationData.invocationId,
      newInvocationData.operations
    );
  }

  private handleExecutionUpdate(
    update: OperationUpdate | undefined,
    operation: Operation
  ): void {
    if (!update) {
      throw new Error("Operation update is missing for execution update");
    }

    if (!operation.Status) {
      throw new Error("Could not find status in execution operation");
    }

    this.executionState.resolveWith({
      result: update.Payload,
      error: update.Error,
      status:
        update.Action === OperationAction.SUCCEED
          ? ExecutionStatus.SUCCEEDED
          : ExecutionStatus.FAILED,
    });
  }

  /**
   * Schedules an async function to execute after a specified delay.
   *
   * This method supports executing both a callback and an invocation function:
   * 1. The callback (if provided) is always executed first after the delay
   * 2. The invocation function is executed only if there's no active invocation (unless skipTime is true)
   *
   * This pattern allows for operations like updating checkpoint data even when
   * invocations are skipped due to active invocation conflicts.
   *
   * @param delaySeconds Delay in seconds before execution
   * @param invocationFunction Function that starts a new invocation (may be skipped if there's an active invocation)
   * @param callback Optional function that always executes after the delay (e.g., for checkpoint updates)
   */
  private scheduleAsyncFunction(
    delaySeconds: number,
    invocationFunction: () => Promise<void>,
    callback?: () => Promise<void>
  ): void {
    this.scheduler.scheduleFunction(
      async () => {
        await callback?.();
        // When skipping time, it's possible an invocation hasn't fully wrapped up before another invocation starts.
        // TODO: add more time skipping options instead of completely skipping all time
        if (this.invocationTracker.hasActiveInvocation() && !this.skipTime) {
          console.warn(
            "Skipping scheduled function execution due to current active invocation"
          );
          return;
        }

        await invocationFunction();
      },
      this.skipTime ? 1 : delaySeconds * 1000,
      (err) => {
        this.executionState.rejectWith(err);
      }
    );
  }

  /**
   * Invokes the handler and determines if execution should continue.
   *
   * When the handler returns "SUCCEEDED/FAILED" status, the execution is resolved
   * and polling stops. For "PENDING" status, execution continues.
   *
   * @param executionId Current execution ID
   * @param checkpointToken Current checkpoint token
   * @param operations Operations for this invocation
   */
  private async invokeHandler(
    executionId: ExecutionId,
    checkpointToken: CheckpointToken,
    invocationId: InvocationId,
    operations: Operation[]
  ): Promise<void> {
    // Create invocation record at the start of each invocation using the tracker
    this.invocationTracker.createInvocation(invocationId);

    try {
      const value = await this.invokeHandlerInstance.invoke(
        this.handlerFunction,
        {
          durableExecutionArn: executionId,
          checkpointToken: checkpointToken,
          operations,
        }
      );

      if (value.Status === InvocationStatus.SUCCEEDED) {
        this.executionState.resolveWith({
          result: value.Result,
          status: OperationStatus.SUCCEEDED,
        });
      } else if (value.Status === InvocationStatus.FAILED) {
        this.executionState.resolveWith({
          error: value.Error,
          status: OperationStatus.FAILED,
        });
      }
    } catch (err) {
      this.executionState.rejectWith(err);
    } finally {
      this.invocationTracker.completeInvocation(invocationId);
    }
  }
}
