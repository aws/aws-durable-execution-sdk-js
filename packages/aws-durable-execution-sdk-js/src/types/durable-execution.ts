import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import { DurableContext } from "./durable-context";
import { DurableLogger } from "./durable-logger";

export type DurableHandler<
  Input,
  Output,
  Logger extends DurableLogger = DurableLogger,
> = (event: Input, context: DurableContext<Logger>) => Promise<Output>;

export interface DurableExecutionConfig {
  client?: LambdaClient;
}

export interface DurableExecutionClient {
  getExecutionState(
    params: GetDurableExecutionStateRequest,
    logger?: DurableLogger,
  ): Promise<GetDurableExecutionStateResponse>;
  checkpoint(
    params: CheckpointDurableExecutionRequest,
    logger?: DurableLogger,
  ): Promise<CheckpointDurableExecutionResponse>;
}
