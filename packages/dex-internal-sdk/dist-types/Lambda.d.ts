import { LambdaClient } from "./LambdaClient";
import {
  CheckpointDurableExecutionCommandInput,
  CheckpointDurableExecutionCommandOutput,
} from "./commands/CheckpointDurableExecutionCommand";
import {
  GetDurableExecutionCommandInput,
  GetDurableExecutionCommandOutput,
} from "./commands/GetDurableExecutionCommand";
import {
  GetDurableExecutionHistoryCommandInput,
  GetDurableExecutionHistoryCommandOutput,
} from "./commands/GetDurableExecutionHistoryCommand";
import {
  GetDurableExecutionStateCommandInput,
  GetDurableExecutionStateCommandOutput,
} from "./commands/GetDurableExecutionStateCommand";
import {
  ListDurableExecutionsCommandInput,
  ListDurableExecutionsCommandOutput,
} from "./commands/ListDurableExecutionsCommand";
import {
  SendDurableExecutionCallbackFailureCommandInput,
  SendDurableExecutionCallbackFailureCommandOutput,
} from "./commands/SendDurableExecutionCallbackFailureCommand";
import {
  SendDurableExecutionCallbackHeartbeatCommandInput,
  SendDurableExecutionCallbackHeartbeatCommandOutput,
} from "./commands/SendDurableExecutionCallbackHeartbeatCommand";
import {
  SendDurableExecutionCallbackSuccessCommandInput,
  SendDurableExecutionCallbackSuccessCommandOutput,
} from "./commands/SendDurableExecutionCallbackSuccessCommand";
import {
  StopDurableExecutionCommandInput,
  StopDurableExecutionCommandOutput,
} from "./commands/StopDurableExecutionCommand";
import { HttpHandlerOptions as __HttpHandlerOptions } from "@smithy/types";
export interface Lambda {
  /**
   * @see {@link CheckpointDurableExecutionCommand}
   */
  checkpointDurableExecution(
    args: CheckpointDurableExecutionCommandInput,
    options?: __HttpHandlerOptions,
  ): Promise<CheckpointDurableExecutionCommandOutput>;
  checkpointDurableExecution(
    args: CheckpointDurableExecutionCommandInput,
    cb: (err: any, data?: CheckpointDurableExecutionCommandOutput) => void,
  ): void;
  checkpointDurableExecution(
    args: CheckpointDurableExecutionCommandInput,
    options: __HttpHandlerOptions,
    cb: (err: any, data?: CheckpointDurableExecutionCommandOutput) => void,
  ): void;
  /**
   * @see {@link GetDurableExecutionCommand}
   */
  getDurableExecution(
    args: GetDurableExecutionCommandInput,
    options?: __HttpHandlerOptions,
  ): Promise<GetDurableExecutionCommandOutput>;
  getDurableExecution(
    args: GetDurableExecutionCommandInput,
    cb: (err: any, data?: GetDurableExecutionCommandOutput) => void,
  ): void;
  getDurableExecution(
    args: GetDurableExecutionCommandInput,
    options: __HttpHandlerOptions,
    cb: (err: any, data?: GetDurableExecutionCommandOutput) => void,
  ): void;
  /**
   * @see {@link GetDurableExecutionHistoryCommand}
   */
  getDurableExecutionHistory(
    args: GetDurableExecutionHistoryCommandInput,
    options?: __HttpHandlerOptions,
  ): Promise<GetDurableExecutionHistoryCommandOutput>;
  getDurableExecutionHistory(
    args: GetDurableExecutionHistoryCommandInput,
    cb: (err: any, data?: GetDurableExecutionHistoryCommandOutput) => void,
  ): void;
  getDurableExecutionHistory(
    args: GetDurableExecutionHistoryCommandInput,
    options: __HttpHandlerOptions,
    cb: (err: any, data?: GetDurableExecutionHistoryCommandOutput) => void,
  ): void;
  /**
   * @see {@link GetDurableExecutionStateCommand}
   */
  getDurableExecutionState(
    args: GetDurableExecutionStateCommandInput,
    options?: __HttpHandlerOptions,
  ): Promise<GetDurableExecutionStateCommandOutput>;
  getDurableExecutionState(
    args: GetDurableExecutionStateCommandInput,
    cb: (err: any, data?: GetDurableExecutionStateCommandOutput) => void,
  ): void;
  getDurableExecutionState(
    args: GetDurableExecutionStateCommandInput,
    options: __HttpHandlerOptions,
    cb: (err: any, data?: GetDurableExecutionStateCommandOutput) => void,
  ): void;
  /**
   * @see {@link ListDurableExecutionsCommand}
   */
  listDurableExecutions(): Promise<ListDurableExecutionsCommandOutput>;
  listDurableExecutions(
    args: ListDurableExecutionsCommandInput,
    options?: __HttpHandlerOptions,
  ): Promise<ListDurableExecutionsCommandOutput>;
  listDurableExecutions(
    args: ListDurableExecutionsCommandInput,
    cb: (err: any, data?: ListDurableExecutionsCommandOutput) => void,
  ): void;
  listDurableExecutions(
    args: ListDurableExecutionsCommandInput,
    options: __HttpHandlerOptions,
    cb: (err: any, data?: ListDurableExecutionsCommandOutput) => void,
  ): void;
  /**
   * @see {@link SendDurableExecutionCallbackFailureCommand}
   */
  sendDurableExecutionCallbackFailure(
    args: SendDurableExecutionCallbackFailureCommandInput,
    options?: __HttpHandlerOptions,
  ): Promise<SendDurableExecutionCallbackFailureCommandOutput>;
  sendDurableExecutionCallbackFailure(
    args: SendDurableExecutionCallbackFailureCommandInput,
    cb: (
      err: any,
      data?: SendDurableExecutionCallbackFailureCommandOutput,
    ) => void,
  ): void;
  sendDurableExecutionCallbackFailure(
    args: SendDurableExecutionCallbackFailureCommandInput,
    options: __HttpHandlerOptions,
    cb: (
      err: any,
      data?: SendDurableExecutionCallbackFailureCommandOutput,
    ) => void,
  ): void;
  /**
   * @see {@link SendDurableExecutionCallbackHeartbeatCommand}
   */
  sendDurableExecutionCallbackHeartbeat(
    args: SendDurableExecutionCallbackHeartbeatCommandInput,
    options?: __HttpHandlerOptions,
  ): Promise<SendDurableExecutionCallbackHeartbeatCommandOutput>;
  sendDurableExecutionCallbackHeartbeat(
    args: SendDurableExecutionCallbackHeartbeatCommandInput,
    cb: (
      err: any,
      data?: SendDurableExecutionCallbackHeartbeatCommandOutput,
    ) => void,
  ): void;
  sendDurableExecutionCallbackHeartbeat(
    args: SendDurableExecutionCallbackHeartbeatCommandInput,
    options: __HttpHandlerOptions,
    cb: (
      err: any,
      data?: SendDurableExecutionCallbackHeartbeatCommandOutput,
    ) => void,
  ): void;
  /**
   * @see {@link SendDurableExecutionCallbackSuccessCommand}
   */
  sendDurableExecutionCallbackSuccess(
    args: SendDurableExecutionCallbackSuccessCommandInput,
    options?: __HttpHandlerOptions,
  ): Promise<SendDurableExecutionCallbackSuccessCommandOutput>;
  sendDurableExecutionCallbackSuccess(
    args: SendDurableExecutionCallbackSuccessCommandInput,
    cb: (
      err: any,
      data?: SendDurableExecutionCallbackSuccessCommandOutput,
    ) => void,
  ): void;
  sendDurableExecutionCallbackSuccess(
    args: SendDurableExecutionCallbackSuccessCommandInput,
    options: __HttpHandlerOptions,
    cb: (
      err: any,
      data?: SendDurableExecutionCallbackSuccessCommandOutput,
    ) => void,
  ): void;
  /**
   * @see {@link StopDurableExecutionCommand}
   */
  stopDurableExecution(
    args: StopDurableExecutionCommandInput,
    options?: __HttpHandlerOptions,
  ): Promise<StopDurableExecutionCommandOutput>;
  stopDurableExecution(
    args: StopDurableExecutionCommandInput,
    cb: (err: any, data?: StopDurableExecutionCommandOutput) => void,
  ): void;
  stopDurableExecution(
    args: StopDurableExecutionCommandInput,
    options: __HttpHandlerOptions,
    cb: (err: any, data?: StopDurableExecutionCommandOutput) => void,
  ): void;
}
/**
 * @public
 */
export declare class Lambda extends LambdaClient implements Lambda {}
