// The runtime dependency on `@aws-sdk/client-lambda` lives in `./lambda-module`. The
// type-only import below is erased at compile time.
import type { LambdaClient } from "@aws-sdk/client-lambda";
import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
} from "../types/wire";
import { DurableExecutionClient } from "../types/durable-execution";
import { log } from "../utils/logger/logger";
import { DurableLogger } from "../types/durable-logger";
import {
  LambdaModule,
  loadLambdaModule,
  resolveDefaultLambdaClient,
} from "./lambda-module";

/**
 * Durable execution client which uses an API-based LambdaClient
 * with built-in error logging. By default, the Lambda client will
 * have custom timeouts set.
 *
 * @public
 */
export class DurableExecutionApiClient implements DurableExecutionClient {
  private readonly injectedClient: LambdaClient | undefined;

  constructor(client?: LambdaClient) {
    this.injectedClient = client;

    // Start loading the AWS SDK now, without blocking construction. This class is
    // instantiated while the execution context is being initialized, so the load overlaps
    // with reading execution state and running the handler up to its first durable
    // operation, rather than delaying that operation. Loading it from here rather than at
    // module scope also means a compute that supplies its own DurableExecutionClient — and
    // therefore never constructs this class — does not load the AWS SDK at all.
    //
    // Rejections are deliberately ignored here: attaching handlers marks the promise as
    // handled so a failure is not reported as an unhandled rejection, and the real error is
    // surfaced to the caller by the request methods, which await the same load.
    void loadLambdaModule().then(
      () => undefined,
      () => undefined,
    );
  }

  /**
   * Resolves the client and command constructors to use, creating and caching the default
   * client on first use when none was injected.
   */
  private async resolveClient(): Promise<{
    client: LambdaClient;
    module: LambdaModule;
  }> {
    const module = await loadLambdaModule();
    const client = this.injectedClient ?? (await resolveDefaultLambdaClient());
    return { client, module };
  }

  /**
   * Gets operation state data from the durable execution
   * @param params - The GetDurableExecutionState request
   * @param logger - Optional developer logger for error reporting
   * @returns Response with operations data
   */
  async getExecutionState(
    params: GetDurableExecutionStateRequest,
    logger?: DurableLogger,
  ): Promise<GetDurableExecutionStateResponse> {
    // Resolved outside the try so that a failure to load or construct the client is not
    // reported as the request itself having failed.
    const { client, module } = await this.resolveClient();

    try {
      const response = await client.send(
        new module.GetDurableExecutionStateCommand({
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
    // Resolved outside the try so that a failure to load or construct the client is not
    // reported as the checkpoint itself having failed.
    const { client, module } = await this.resolveClient();

    try {
      const response = await client.send(
        new module.CheckpointDurableExecutionCommand({
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
