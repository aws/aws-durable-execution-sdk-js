// The SDK's only runtime dependency on `@aws-sdk/client-lambda` is confined to this
// module. It is deliberately not re-exported from `src/index.ts`, so neither the loader
// nor the `LambdaModule` shape reaches the published API surface.
//
// The client and command classes are loaded with a dynamic import the first time they are
// actually needed rather than at module scope. Loading the Lambda client is the single
// largest contributor to this package's import cost, and a compute that supplies its own
// `DurableExecutionClient` should not pay it at all. The type-only import below is erased
// at compile time and adds nothing to the bundle.
import type {
  CheckpointDurableExecutionCommand as CheckpointDurableExecutionCommandType,
  GetDurableExecutionStateCommand as GetDurableExecutionStateCommandType,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import {
  CheckpointDurableExecutionRequest,
  GetDurableExecutionStateRequest,
} from "../types/wire";
import { SDK_NAME, SDK_VERSION } from "../utils/constants/version";

/**
 * The subset of `@aws-sdk/client-lambda` this package needs at runtime.
 *
 * @internal
 */
export interface LambdaModule {
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
 * Configuration applied to the client this package creates for itself. Callers who need
 * different settings inject their own client instead.
 */
const DEFAULT_CLIENT_CONFIG = {
  customUserAgent: [[SDK_NAME, SDK_VERSION]],
  requestHandler: {
    connectionTimeout: 5000,
    socketTimeout: 50000,
    requestTimeout: 55000,
    throwOnRequestTimeout: true,
  },
};

/**
 * Loads `@aws-sdk/client-lambda` on first use and memoizes the result, so concurrent
 * callers share a single import.
 *
 * The namespace shape depends on how the bundle consuming this module resolves the
 * dependency: a dynamic import from CommonJS may yield the module's exports under
 * `default` rather than as named exports, so both layouts are accepted.
 *
 * A failed load clears the memo, leaving a later call free to retry rather than caching
 * the failure for the lifetime of the process.
 *
 * @internal
 */
export const loadLambdaModule = (): Promise<LambdaModule> => {
  lambdaModulePromise ??= import("@aws-sdk/client-lambda")
    .then((module) => {
      const namespace = module as unknown as
        | LambdaModule
        | { default: LambdaModule };
      return "LambdaClient" in namespace ? namespace : namespace.default;
    })
    .catch((error: unknown) => {
      lambdaModulePromise = undefined;
      throw error;
    });
  return lambdaModulePromise;
};

/**
 * Resolves the client this package creates when the caller did not supply one, creating it
 * on first use and caching it so connections are reused across instances.
 *
 * @internal
 */
export const resolveDefaultLambdaClient = async (): Promise<LambdaClient> => {
  const module = await loadLambdaModule();
  defaultLambdaClient ??= new module.LambdaClient(DEFAULT_CLIENT_CONFIG);
  return defaultLambdaClient;
};
