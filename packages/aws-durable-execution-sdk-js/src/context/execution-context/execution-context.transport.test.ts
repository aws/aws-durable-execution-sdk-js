// Checks that a supplied transport stops initialization from building the
// Lambda transport. The DurableExecutionApiClient constructor loads the AWS SDK,
// so only a module mock can see whether it ran. execution-context.test.ts uses
// the real module, so these cases live here.
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Context } from "aws-lambda";
import { OperationType, type Operation } from "../../types/wire";
import type { DurableExecutionInvocationInput } from "../../types";
import type { DurableExecutionClient } from "../../types/durable-execution";
import { DurableExecutionApiClient } from "../../durable-execution-api-client/durable-execution-api-client";
import { DurableExecutionInvocationInputWithClient } from "../../utils/durable-execution-invocation-input/durable-execution-invocation-input";
import { initializeExecutionContext } from "./execution-context";

vi.mock("../../durable-execution-api-client/durable-execution-api-client");

const executionOperation: Operation = {
  Id: "",
  Name: "",
  Type: OperationType.EXECUTION,
  StartTimestamp: new Date(),
  Status: "STARTED",
  ExecutionDetails: { InputPayload: "{}" },
};

const event = (nextMarker: string): DurableExecutionInvocationInput => ({
  CheckpointToken: "token",
  DurableExecutionArn: "arn",
  InitialExecutionState: {
    Operations: [executionOperation],
    NextMarker: nextMarker,
  },
});

const lambdaContext = {
  getRemainingTimeInMillis: () => 30000,
} as unknown as Context;

const fakeClient = (): DurableExecutionClient => ({
  getExecutionState: vi.fn().mockResolvedValue({ Operations: [] }),
  checkpoint: vi.fn().mockResolvedValue({}),
});

describe("initializeExecutionContext transport construction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Shows that the mock sees the constructor, so the cases below can fail.
  it("builds the Lambda transport when no transport is supplied", async () => {
    await initializeExecutionContext(event(""), lambdaContext);

    expect(DurableExecutionApiClient).toHaveBeenCalledTimes(1);
  });

  it("does not build the Lambda transport for a configured client", async () => {
    const client = fakeClient();

    await initializeExecutionContext(event("more"), lambdaContext, {
      durableExecutionClient: client,
    });

    expect(client.getExecutionState).toHaveBeenCalledTimes(1);
    expect(DurableExecutionApiClient).not.toHaveBeenCalled();
  });

  it("does not build the Lambda transport for an event-injected client", async () => {
    const client = fakeClient();
    const wrapped = new DurableExecutionInvocationInputWithClient(
      event("more"),
      client,
    );

    await initializeExecutionContext(wrapped, lambdaContext);

    expect(client.getExecutionState).toHaveBeenCalledTimes(1);
    expect(DurableExecutionApiClient).not.toHaveBeenCalled();
  });
});
