"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Lambda = void 0;
const LambdaClient_1 = require("./LambdaClient");
const CheckpointDurableExecutionCommand_1 = require("./commands/CheckpointDurableExecutionCommand");
const GetDurableExecutionCommand_1 = require("./commands/GetDurableExecutionCommand");
const GetDurableExecutionHistoryCommand_1 = require("./commands/GetDurableExecutionHistoryCommand");
const GetDurableExecutionStateCommand_1 = require("./commands/GetDurableExecutionStateCommand");
const ListDurableExecutionsCommand_1 = require("./commands/ListDurableExecutionsCommand");
const SendDurableExecutionCallbackFailureCommand_1 = require("./commands/SendDurableExecutionCallbackFailureCommand");
const SendDurableExecutionCallbackHeartbeatCommand_1 = require("./commands/SendDurableExecutionCallbackHeartbeatCommand");
const SendDurableExecutionCallbackSuccessCommand_1 = require("./commands/SendDurableExecutionCallbackSuccessCommand");
const StopDurableExecutionCommand_1 = require("./commands/StopDurableExecutionCommand");
const smithy_client_1 = require("@smithy/smithy-client");
const commands = {
  CheckpointDurableExecutionCommand:
    CheckpointDurableExecutionCommand_1.CheckpointDurableExecutionCommand,
  GetDurableExecutionCommand:
    GetDurableExecutionCommand_1.GetDurableExecutionCommand,
  GetDurableExecutionHistoryCommand:
    GetDurableExecutionHistoryCommand_1.GetDurableExecutionHistoryCommand,
  GetDurableExecutionStateCommand:
    GetDurableExecutionStateCommand_1.GetDurableExecutionStateCommand,
  ListDurableExecutionsCommand:
    ListDurableExecutionsCommand_1.ListDurableExecutionsCommand,
  SendDurableExecutionCallbackFailureCommand:
    SendDurableExecutionCallbackFailureCommand_1.SendDurableExecutionCallbackFailureCommand,
  SendDurableExecutionCallbackHeartbeatCommand:
    SendDurableExecutionCallbackHeartbeatCommand_1.SendDurableExecutionCallbackHeartbeatCommand,
  SendDurableExecutionCallbackSuccessCommand:
    SendDurableExecutionCallbackSuccessCommand_1.SendDurableExecutionCallbackSuccessCommand,
  StopDurableExecutionCommand:
    StopDurableExecutionCommand_1.StopDurableExecutionCommand,
};
class Lambda extends LambdaClient_1.LambdaClient {}
exports.Lambda = Lambda;
(0, smithy_client_1.createAggregatedClient)(commands, Lambda);
