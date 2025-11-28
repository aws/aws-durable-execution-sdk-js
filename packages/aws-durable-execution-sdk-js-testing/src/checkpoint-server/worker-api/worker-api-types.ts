export enum ApiType {
  StartDurableExecution = "StartDurableExecution",
  StartInvocation = "StartInvocation",
  CompleteInvocation = "CompleteInvocation",
  UpdateCheckpointData = "UpdateCheckpointData",
  PollCheckpointData = "PollCheckpointData",
  GetDurableExecutionState = "GetDurableExecutionState",
  CheckpointDurableExecutionState = "CheckpointDurableExecutionState",
  SendDurableExecutionCallbackSuccess = "SendDurableExecutionCallbackSuccess",
  SendDurableExecutionCallbackFailure = "SendDurableExecutionCallbackFailure",
  SendDurableExecutionCallbackHeartbeat = "SendDurableExecutionCallbackHeartbeat",
}
