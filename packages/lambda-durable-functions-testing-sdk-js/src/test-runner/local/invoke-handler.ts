import { Operation } from "@amzn/dex-internal-sdk";
import { Context } from "aws-lambda";
import {
  withDurableFunctions,
  DurableExecutionInvocationOutput,
} from "@amzn/durable-executions-language-sdk";
import { randomUUID } from "node:crypto";

export interface HandlerParameters {
  durableExecutionArn: string;
  operations: Operation[];
  checkpointToken: string;
  contextValues?: Partial<Context>;
}

/**
 * Handles invocation of durable function handlers with proper context setup
 * and parameter formatting for the LocalDurableTestRunner.
 */
export class InvokeHandler {
  private readonly defaultContextValues: Context;

  constructor(defaultContextValues?: Partial<Context>) {
    this.defaultContextValues = {
      callbackWaitsForEmptyEventLoop: false,
      functionName: "my-function-name",
      functionVersion: "1",
      invokedFunctionArn:
        "arn:aws:lambda:us-east-2:123456789012:function:my-function-name",
      memoryLimitInMB: "1024",
      awsRequestId: randomUUID(),
      logGroupName: "MyLogGroupName",
      logStreamName: "MyLogStreamName",
      getRemainingTimeInMillis: function (): number {
        throw new Error("Function not implemented.");
      },
      done: function (): void {
        throw new Error("Function not implemented.");
      },
      fail: function (): void {
        throw new Error("Function not implemented.");
      },
      succeed: function (): void {
        throw new Error("Function not implemented.");
      },
      ...defaultContextValues,
    } satisfies Context;
  }

  /**
   * Invokes the durable function handler with the provided parameters.
   *
   * @param handler The durable function handler to invoke
   * @param parameters Parameters for the handler invocation
   * @returns Promise resolving to the handler's output
   */
  async invoke(
    handler: ReturnType<typeof withDurableFunctions>,
    parameters: HandlerParameters
  ): Promise<DurableExecutionInvocationOutput> {
    const invocationEvent = this.buildInvocationEvent(parameters);
    const context = this.buildContext(parameters.contextValues);

    return await handler(invocationEvent, context);
  }

  /**
   * Builds the invocation event structure required by the durable function handler.
   *
   * @param parameters Handler parameters containing execution details
   * @returns Formatted invocation event
   */
  private buildInvocationEvent(parameters: HandlerParameters) {
    return {
      CheckpointToken: parameters.checkpointToken,
      DurableExecutionArn: parameters.durableExecutionArn,
      InitialExecutionState: {
        Operations: parameters.operations,
        NextMarker: "",
      },
    };
  }

  /**
   * Builds the Lambda context by merging default values with provided overrides.
   *
   * @param contextValues Optional context value overrides
   * @returns Complete Lambda context object
   */
  private buildContext(contextValues?: Partial<Context>): Context {
    return {
      ...this.defaultContextValues,
      ...contextValues,
    };
  }
}
