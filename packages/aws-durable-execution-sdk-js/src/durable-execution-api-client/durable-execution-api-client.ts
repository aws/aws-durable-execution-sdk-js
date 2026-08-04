// This module is the SDK's only runtime dependency on `@aws-sdk/client-lambda`.
//
// The client and command classes are loaded with a dynamic import the first time a
// request is actually made, rather than at module scope. Loading the Lambda client is
// the single largest contributor to this package's import cost, and executions that
// inject their own client — or that never reach a checkpoint — should not pay it. The
// type-only import below is erased at compile time and adds nothing to the bundle.
import type {
  CheckpointDurableExecutionCommand as CheckpointDurableExecutionCommandType,
  GetDurableExecutionStateCommand as GetDurableExecutionStateCommandType,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
} from "../types/wire";
import { DurableExecutionClient } from "../types/durable-execution";
import { log } from "../utils/logger/logger";
import { DurableLogger } from "../types/durable-logger";
import { SDK_NAME, SDK_VERSION } from "../utils/constants/version";

/**
 * The subset of `@aws-sdk/client-lambda` this module needs at runtime.
 */
interface LambdaModule {
  LambdaClient: new (config: Record<string, unknown>) => LambdaClient;
  CheckpointDurableExecutionCommand: new (
    input: CheckpointDurableExecutionRequest,
  ) => CheckpointDurableExecutionCommandType;
  GetDurableExecutionStateCommand: new (
    input: GetDurableExecutionStateRequest,
  ) => GetDurableExecutionStateCommandType;
}

let lambdaModulePromise: Promise<LambdaModule> | undefined;
let defaultLambdaClient: LambdaClient | undefined;

/**
 * Loads `@aws-sdk/client-lambda` on first use and memoizes the result, so concurrent
 * callers share a single import.
 *
 * The namespace shape depends on how the bundle consuming this module resolves the
 * dependency: a dynamic import from CommonJS may yield the module's exports under
 * `default` rather than as named exports, so both layouts are accepted.
 */
const loadLambdaModule = (): Promise<LambdaModule> => {
  lambdaModulePromise ??= import("@aws-sdk/client-lambda").then((module) => {
    const namespace = module as unknown as
      | LambdaModule
      | { default: LambdaModule };
    return "LambdaClient" in namespace ? namespace : namespace.default;
  });
  return lambdaModulePromise;
};

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
    // operation, rather than delaying that operation. Loading it here rather than at module
    // scope also means a compute that supplies its own DurableExecutionClient — and
    // therefore never constructs this class — does not load the AWS SDK at all.
    //
    // Rejections are deliberately ignored here: attaching handlers marks the memoized
    // promise as handled so a failure is not reported as an unhandled rejection, and the
    // real error is surfaced to the caller by `resolveClient`, which awaits the same
    // promise.
    void loadLambdaModule().then(
      () => undefined,
      () => undefined,
    );
  }

  /**
   * Resolves the client to use, creating and caching the default one on first use when no
   * client was injected.
   *
   * @internal This is not part of the supported API surface. It is exposed rather than
   * private because the SDK's own tests and the `lambda-runtime-detection-integration-test`
   * package need to force the lazy load and inspect the resulting client without issuing a
   * request.
   */
  async resolveClient(): Promise<{
    client: LambdaClient;
    module: LambdaModule;
  }> {
    const module = await loadLambdaModule();

    if (this.injectedClient) {
      return { client: this.injectedClient, module };
    }

    defaultLambdaClient ??= new module.LambdaClient({
      customUserAgent: [[SDK_NAME, SDK_VERSION]],
      requestHandler: {
        connectionTimeout: 5000,
        socketTimeout: 50000,
        requestTimeout: 55000,
        throwOnRequestTimeout: true,
      },
    });

    return { client: defaultLambdaClient, module };
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
    try {
      const { client, module } = await this.resolveClient();
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
    try {
      const { client, module } = await this.resolveClient();
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
