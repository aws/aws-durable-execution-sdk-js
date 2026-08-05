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
 * Exercises the transport contract using no AWS types.
 *
 * This is a readable demonstration that a transport can be written against
 * {@link DurableExecutionClient} without reaching for `@aws-sdk/*` or `aws-lambda`, and that
 * such an implementation satisfies {@link DurableExecutionConfig.durableExecutionClient} and
 * can classify its own failures.
 *
 * It is deliberately not claimed as a gate on AWS-freedom, because it is a weak one: this
 * file imports {@link DurableExecutionConfig}, which already names `LambdaClient` through
 * its deprecated `client` property and compiles regardless; an AWS-typed field added to a
 * request shape would go unnoticed, since only `params.Marker` is read; and an *optional*
 * AWS-typed field added to a response shape would also compile, because an object literal
 * need not supply it. Only a newly *required* AWS-typed response field would break it.
 *
 * The actual gates are elsewhere: the `no-restricted-imports` rule on `src/types/wire/**`
 * (see `eslint.config.js`), which fails the build if an AWS import appears in the wire
 * model at all, and `wire-model.aws-sdk-parity.test.ts`, which pins those shapes to the
 * service model in both directions.
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
