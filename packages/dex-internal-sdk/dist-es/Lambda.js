import { LambdaClient } from "./LambdaClient";
import { CheckpointDurableExecutionCommand } from "./commands/CheckpointDurableExecutionCommand";
import { GetDurableExecutionCommand } from "./commands/GetDurableExecutionCommand";
import { GetDurableExecutionHistoryCommand } from "./commands/GetDurableExecutionHistoryCommand";
import { GetDurableExecutionStateCommand } from "./commands/GetDurableExecutionStateCommand";
import { ListDurableExecutionsCommand } from "./commands/ListDurableExecutionsCommand";
import { SendDurableExecutionCallbackFailureCommand } from "./commands/SendDurableExecutionCallbackFailureCommand";
import { SendDurableExecutionCallbackHeartbeatCommand } from "./commands/SendDurableExecutionCallbackHeartbeatCommand";
import { SendDurableExecutionCallbackSuccessCommand } from "./commands/SendDurableExecutionCallbackSuccessCommand";
import { StopDurableExecutionCommand } from "./commands/StopDurableExecutionCommand";
import { createAggregatedClient } from "@smithy/smithy-client";
const commands = {
  CheckpointDurableExecutionCommand,
  GetDurableExecutionCommand,
  GetDurableExecutionHistoryCommand,
  GetDurableExecutionStateCommand,
  ListDurableExecutionsCommand,
  SendDurableExecutionCallbackFailureCommand,
  SendDurableExecutionCallbackHeartbeatCommand,
  SendDurableExecutionCallbackSuccessCommand,
  StopDurableExecutionCommand,
};
export class Lambda extends LambdaClient {}
createAggregatedClient(commands, Lambda);
