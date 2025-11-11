import {
  CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateCommand,
  GetDurableExecutionStateResponse,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import { ExecutionState } from "./storage";
import { log } from "../utils/logger/logger";
import { Logger } from "../types";

/**
 * Implementation of ExecutionState that uses the new \@aws-sdk/client-lambda
 */
export class ApiStorage implements ExecutionState {
  protected client: LambdaClient;

  constructor() {
    this.client = new LambdaClient();
  }

  /**
   * Gets step data from the durable execution
   * @param checkpointToken - The checkpoint token
   * @param nextMarker - The pagination token
   * @param logger - Optional developer logger for error reporting
   * @returns Response with operations data
   */
  async getStepData(
    checkpointToken: string,
    durableExecutionArn: string,
    nextMarker: string,
    logger?: Logger,
  ): Promise<GetDurableExecutionStateResponse> {
    try {
      const response = await this.client.send(
        new GetDurableExecutionStateCommand({
          DurableExecutionArn: durableExecutionArn,
          CheckpointToken: checkpointToken,
          Marker: nextMarker,
          MaxItems: 1000,
        }),
      );

      return response;
    } catch (error) {
      // Internal debug logging
      log("❌", "GetDurableExecutionState failed", {
        error,
        requestId: (error as { $metadata?: { requestId?: string } })?.$metadata
          ?.requestId,
        DurableExecutionArn: durableExecutionArn,
        CheckpointToken: checkpointToken,
        Marker: nextMarker,
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
   * @param checkpointToken - The checkpoint token
   * @param data - The checkpoint data
   * @param logger - Optional developer logger for error reporting
   * @returns Checkpoint response
   */
  async checkpoint(
    checkpointToken: string,
    data: CheckpointDurableExecutionRequest,
    logger?: Logger,
  ): Promise<CheckpointDurableExecutionResponse> {
    try {
      const response = await this.client.send(
        new CheckpointDurableExecutionCommand({
          DurableExecutionArn: data.DurableExecutionArn,
          CheckpointToken: checkpointToken,
          ClientToken: data.ClientToken,
          Updates: data.Updates,
        }),
      );
      return response;
    } catch (error) {
      // Internal debug logging
      log("❌", "CheckpointDurableExecution failed", {
        error,
        requestId: (error as { $metadata?: { requestId?: string } })?.$metadata
          ?.requestId,
        DurableExecutionArn: data.DurableExecutionArn,
        CheckpointToken: checkpointToken,
        ClientToken: data.ClientToken,
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
