import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
  DurableExecutionClient,
  DurableExecutionClientError,
  DurableExecutionClientErrorScope,
  DurableExecutionConfig,
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
  OperationStatus,
  OperationType,
  isDurableExecutionClientError,
} from "./index";

/**
 * Guards the promise that a transport can be written without depending on AWS.
 *
 * This file imports nothing from `@aws-sdk/*` or `aws-lambda`, so it fails to compile if an
 * AWS type ever reappears in the transitive closure of {@link DurableExecutionClient}, its
 * request and response shapes, or {@link DurableExecutionConfig.durableExecutionClient}.
 * That property is what makes durable functions portable to compute types other than
 * Lambda, and it is easy to lose by accident: adding one AWS-typed field to any of the wire
 * shapes would do it, and nothing else in the suite would notice.
 *
 * What this does not cover: it exercises the contract's types and the error classification
 * in isolation, not a full execution. End-to-end behaviour of an injected transport is
 * covered by the execution-context transport-selection tests and the checkpoint error
 * classification tests.
 */

/** A transport with no AWS dependency of any kind. */
class HttpDurableExecutionClient implements DurableExecutionClient {
  constructor(private readonly failWith?: DurableExecutionClientError) {}

  async getExecutionState(
    params: GetDurableExecutionStateRequest,
  ): Promise<GetDurableExecutionStateResponse> {
    if (this.failWith) throw this.failWith;

    return {
      // Timestamps are strings here, as they arrive over a JSON transport.
      Operations: [
        {
          Id: "op-1",
          Type: OperationType.STEP,
          Status: OperationStatus.SUCCEEDED,
          StartTimestamp: "2026-07-13T22:11:27.127Z",
          EndTimestamp: "2026-07-13T22:11:28.000Z",
          StepDetails: { Attempt: 0, Result: '"done"' },
        },
      ],
      NextMarker: params.Marker,
    };
  }

  async checkpoint(
    params: CheckpointDurableExecutionRequest,
  ): Promise<CheckpointDurableExecutionResponse> {
    if (this.failWith) throw this.failWith;

    return {
      CheckpointToken: `${params.CheckpointToken}-next`,
      NewExecutionState: { Operations: [] },
    };
  }
}

describe("DurableExecutionClient contract", () => {
  it("is implementable without importing any AWS type", async () => {
    const client: DurableExecutionClient = new HttpDurableExecutionClient();

    const state = await client.getExecutionState({
      DurableExecutionArn: "urn:my-compute:execution:abc",
      CheckpointToken: "token-1",
    });

    expect(state.Operations?.[0]).toMatchObject({
      Id: "op-1",
      Type: OperationType.STEP,
      Status: OperationStatus.SUCCEEDED,
    });
  });

  it("accepts identifiers that are not ARNs", async () => {
    // Nothing in the contract requires an AWS resource name.
    const client: DurableExecutionClient = new HttpDurableExecutionClient();

    const response = await client.checkpoint({
      DurableExecutionArn: "urn:my-compute:execution:abc",
      CheckpointToken: "token-1",
      Updates: [],
    });

    expect(response.CheckpointToken).toBe("token-1-next");
  });

  it("is assignable to the compute-neutral config option", () => {
    const config: DurableExecutionConfig = {
      durableExecutionClient: new HttpDurableExecutionClient(),
    };

    expect(config.durableExecutionClient).toBeDefined();
  });

  it("can state that a failure is fatal for the execution", async () => {
    const fatal = new DurableExecutionClientError("execution not found", {
      scope: DurableExecutionClientErrorScope.EXECUTION,
    });
    const client: DurableExecutionClient = new HttpDurableExecutionClient(
      fatal,
    );

    await expect(
      client.checkpoint({
        DurableExecutionArn: "urn:my-compute:execution:abc",
        CheckpointToken: "token-1",
      }),
    ).rejects.toBe(fatal);

    expect(isDurableExecutionClientError(fatal)).toBe(true);
    expect(fatal.scope).toBe(DurableExecutionClientErrorScope.EXECUTION);
  });
});
