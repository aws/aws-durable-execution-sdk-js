import {
  CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateCommand,
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import { ExecutionState } from "./storage";
import { log } from "../utils/logger/logger";
import { DurableLogger } from "../types/durable-logger";

/**
 * Implementation of ExecutionState that uses the new \@aws-sdk/client-lambda
 */
export class ApiStorage implements ExecutionState {
  private client: LambdaClient;

  constructor() {
    this.client = new LambdaClient({
      requestHandler: {
        connectionTimeout: 5000,
        socketTimeout: 50000,
        requestTimeout: 55000,
        throwOnRequestTimeout: true,
      },
    });
  }

  /**
   * Gets operation state data from the durable execution
   * @param params - The GetDurableExecutionState request
   * @param logger - Optional developer logger for error reporting
   * @returns Response with operations data
   */
  async getStepData(
    params: GetDurableExecutionStateRequest,
    logger?: DurableLogger,
  ): Promise<GetDurableExecutionStateResponse> {
    try {
      const response = await this.client.send(
        new GetDurableExecutionStateCommand({
          DurableExecutionArn: params.DurableExecutionArn,
          CheckpointToken: params.CheckpointToken,
          Marker: params.Marker,
          MaxItems: params.MaxItems,
        }),
      );

      return response;
    } catch (error) {
      // Internal debug logging
      log("❌", "GetDurableExecutionState failed", {
        error,
        requestId: (error as { $metadata?: { requestId?: string } })?.$metadata
          ?.requestId,
        DurableExecutionArn: params.DurableExecutionArn,
        CheckpointToken: params.CheckpointToken,
        Marker: params.Marker,
      });

      // Developer logging if logger provided
      if (logger) {
        logger.error("Failed to get durable execution state", error as Error, {
          requestId: (error as { $metadata?: { requestId?: string } })
            ?.$metadata?.requestId,
        });
      }

      throw error;
    }
  }

  /**
   * Checkpoints the durable execution with operation updates
   * @param params - The checkpoint request
   * @param logger - Optional developer logger for error reporting
   * @returns Checkpoint response
   */
  async checkpoint(
    params: CheckpointDurableExecutionRequest,
    logger?: DurableLogger,
  ): Promise<CheckpointDurableExecutionResponse> {
    try {
      const response = await this.client.send(
        new CheckpointDurableExecutionCommand({
          DurableExecutionArn: params.DurableExecutionArn,
          CheckpointToken: params.CheckpointToken,
          ClientToken: params.ClientToken,
          Updates: params.Updates,
        }),
      );
      return response;
    } catch (error) {
      // Internal debug logging
      log("❌", "CheckpointDurableExecution failed", {
        error,
        requestId: (error as { $metadata?: { requestId?: string } })?.$metadata
          ?.requestId,
        DurableExecutionArn: params.DurableExecutionArn,
        CheckpointToken: params.CheckpointToken,
        ClientToken: params.ClientToken,
      });

      // Developer logging if logger provided
      if (logger) {
        logger.error("Failed to checkpoint durable execution", error as Error, {
          requestId: (error as { $metadata?: { requestId?: string } })
            ?.$metadata?.requestId,
        });
      }

      throw error;
    }
  }
}
