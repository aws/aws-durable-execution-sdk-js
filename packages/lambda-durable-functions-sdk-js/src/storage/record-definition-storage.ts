import {
  CheckpointDurableExecutionCommand,
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  GetDurableExecutionStateCommand,
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
} from "@amzn/dex-internal-sdk";
import {
  DurableExecutionInvocationInput,
  DurableExecutionInvocationOutput,
} from "../types";
import { log } from "../utils/logger/logger";
import { ApiStorage } from "./api-storage";

interface CheckpointDefinition {
  input: CheckpointDurableExecutionRequest;
  output: CheckpointDurableExecutionResponse;
}

interface StepDataDefinition {
  input: GetDurableExecutionStateRequest;
  output: GetDurableExecutionStateResponse;
}

export interface InvocationDefinition {
  stepData: StepDataDefinition[];
  checkpoints: CheckpointDefinition[];
  event: DurableExecutionInvocationInput | undefined;
  response: DurableExecutionInvocationOutput | undefined;
}

export class RecordDefinitionStorage extends ApiStorage {
  private snapshotData: InvocationDefinition = {
    stepData: [],
    checkpoints: [],
    event: undefined,
    response: undefined,
  };

  constructor() {
    super();
  }

  async getStepData(
    taskToken: string,
    nextToken: string,
  ): Promise<GetDurableExecutionStateResponse> {
    const input: GetDurableExecutionStateRequest = {
      CheckpointToken: taskToken,
      Marker: nextToken,
      MaxItems: 1000,
    };

    const output = await this.client.send(
      new GetDurableExecutionStateCommand(input),
    );

    this.snapshotData.stepData.push({
      input,
      output,
    });

    return output;
  }

  async checkpoint(
    taskToken: string,
    data: CheckpointDurableExecutionRequest,
  ): Promise<CheckpointDurableExecutionResponse> {
    const input: CheckpointDurableExecutionRequest = {
      CheckpointToken: taskToken,
      Updates: data.Updates,
      ClientToken: data.ClientToken,
    };

    const output = await this.client.send(
      new CheckpointDurableExecutionCommand(input),
    );

    this.snapshotData.checkpoints.push({
      input,
      output,
    });

    return output;
  }

  complete(
    event: DurableExecutionInvocationInput,
    response: DurableExecutionInvocationOutput,
  ): void {
    this.snapshotData.event = event;
    this.snapshotData.response = response;
    log(
      true,
      "📝",
      `Invocation definition for ${event.DurableExecutionArn}:`,
      this.snapshotData,
    );
  }
}
