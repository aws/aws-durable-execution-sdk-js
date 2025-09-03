import {
  CheckpointDurableExecutionCommandInput,
  CheckpointDurableExecutionCommandOutput,
} from "../commands/CheckpointDurableExecutionCommand";
import {
  GetDurableExecutionCommandInput,
  GetDurableExecutionCommandOutput,
} from "../commands/GetDurableExecutionCommand";
import {
  GetDurableExecutionHistoryCommandInput,
  GetDurableExecutionHistoryCommandOutput,
} from "../commands/GetDurableExecutionHistoryCommand";
import {
  GetDurableExecutionStateCommandInput,
  GetDurableExecutionStateCommandOutput,
} from "../commands/GetDurableExecutionStateCommand";
import {
  ListDurableExecutionsCommandInput,
  ListDurableExecutionsCommandOutput,
} from "../commands/ListDurableExecutionsCommand";
import {
  SendDurableExecutionCallbackFailureCommandInput,
  SendDurableExecutionCallbackFailureCommandOutput,
} from "../commands/SendDurableExecutionCallbackFailureCommand";
import {
  SendDurableExecutionCallbackHeartbeatCommandInput,
  SendDurableExecutionCallbackHeartbeatCommandOutput,
} from "../commands/SendDurableExecutionCallbackHeartbeatCommand";
import {
  SendDurableExecutionCallbackSuccessCommandInput,
  SendDurableExecutionCallbackSuccessCommandOutput,
} from "../commands/SendDurableExecutionCallbackSuccessCommand";
import {
  StopDurableExecutionCommandInput,
  StopDurableExecutionCommandOutput,
} from "../commands/StopDurableExecutionCommand";
import {
  HttpRequest as __HttpRequest,
  HttpResponse as __HttpResponse,
} from "@smithy/protocol-http";
import { SerdeContext as __SerdeContext } from "@smithy/types";
/**
 * serializeAws_restJson1CheckpointDurableExecutionCommand
 */
export declare const se_CheckpointDurableExecutionCommand: (
  input: CheckpointDurableExecutionCommandInput,
  context: __SerdeContext,
) => Promise<__HttpRequest>;
/**
 * serializeAws_restJson1GetDurableExecutionCommand
 */
export declare const se_GetDurableExecutionCommand: (
  input: GetDurableExecutionCommandInput,
  context: __SerdeContext,
) => Promise<__HttpRequest>;
/**
 * serializeAws_restJson1GetDurableExecutionHistoryCommand
 */
export declare const se_GetDurableExecutionHistoryCommand: (
  input: GetDurableExecutionHistoryCommandInput,
  context: __SerdeContext,
) => Promise<__HttpRequest>;
/**
 * serializeAws_restJson1GetDurableExecutionStateCommand
 */
export declare const se_GetDurableExecutionStateCommand: (
  input: GetDurableExecutionStateCommandInput,
  context: __SerdeContext,
) => Promise<__HttpRequest>;
/**
 * serializeAws_restJson1ListDurableExecutionsCommand
 */
export declare const se_ListDurableExecutionsCommand: (
  input: ListDurableExecutionsCommandInput,
  context: __SerdeContext,
) => Promise<__HttpRequest>;
/**
 * serializeAws_restJson1SendDurableExecutionCallbackFailureCommand
 */
export declare const se_SendDurableExecutionCallbackFailureCommand: (
  input: SendDurableExecutionCallbackFailureCommandInput,
  context: __SerdeContext,
) => Promise<__HttpRequest>;
/**
 * serializeAws_restJson1SendDurableExecutionCallbackHeartbeatCommand
 */
export declare const se_SendDurableExecutionCallbackHeartbeatCommand: (
  input: SendDurableExecutionCallbackHeartbeatCommandInput,
  context: __SerdeContext,
) => Promise<__HttpRequest>;
/**
 * serializeAws_restJson1SendDurableExecutionCallbackSuccessCommand
 */
export declare const se_SendDurableExecutionCallbackSuccessCommand: (
  input: SendDurableExecutionCallbackSuccessCommandInput,
  context: __SerdeContext,
) => Promise<__HttpRequest>;
/**
 * serializeAws_restJson1StopDurableExecutionCommand
 */
export declare const se_StopDurableExecutionCommand: (
  input: StopDurableExecutionCommandInput,
  context: __SerdeContext,
) => Promise<__HttpRequest>;
/**
 * deserializeAws_restJson1CheckpointDurableExecutionCommand
 */
export declare const de_CheckpointDurableExecutionCommand: (
  output: __HttpResponse,
  context: __SerdeContext,
) => Promise<CheckpointDurableExecutionCommandOutput>;
/**
 * deserializeAws_restJson1GetDurableExecutionCommand
 */
export declare const de_GetDurableExecutionCommand: (
  output: __HttpResponse,
  context: __SerdeContext,
) => Promise<GetDurableExecutionCommandOutput>;
/**
 * deserializeAws_restJson1GetDurableExecutionHistoryCommand
 */
export declare const de_GetDurableExecutionHistoryCommand: (
  output: __HttpResponse,
  context: __SerdeContext,
) => Promise<GetDurableExecutionHistoryCommandOutput>;
/**
 * deserializeAws_restJson1GetDurableExecutionStateCommand
 */
export declare const de_GetDurableExecutionStateCommand: (
  output: __HttpResponse,
  context: __SerdeContext,
) => Promise<GetDurableExecutionStateCommandOutput>;
/**
 * deserializeAws_restJson1ListDurableExecutionsCommand
 */
export declare const de_ListDurableExecutionsCommand: (
  output: __HttpResponse,
  context: __SerdeContext,
) => Promise<ListDurableExecutionsCommandOutput>;
/**
 * deserializeAws_restJson1SendDurableExecutionCallbackFailureCommand
 */
export declare const de_SendDurableExecutionCallbackFailureCommand: (
  output: __HttpResponse,
  context: __SerdeContext,
) => Promise<SendDurableExecutionCallbackFailureCommandOutput>;
/**
 * deserializeAws_restJson1SendDurableExecutionCallbackHeartbeatCommand
 */
export declare const de_SendDurableExecutionCallbackHeartbeatCommand: (
  output: __HttpResponse,
  context: __SerdeContext,
) => Promise<SendDurableExecutionCallbackHeartbeatCommandOutput>;
/**
 * deserializeAws_restJson1SendDurableExecutionCallbackSuccessCommand
 */
export declare const de_SendDurableExecutionCallbackSuccessCommand: (
  output: __HttpResponse,
  context: __SerdeContext,
) => Promise<SendDurableExecutionCallbackSuccessCommandOutput>;
/**
 * deserializeAws_restJson1StopDurableExecutionCommand
 */
export declare const de_StopDurableExecutionCommand: (
  output: __HttpResponse,
  context: __SerdeContext,
) => Promise<StopDurableExecutionCommandOutput>;
