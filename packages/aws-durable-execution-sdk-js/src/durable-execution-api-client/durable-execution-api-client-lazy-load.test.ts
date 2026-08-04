import { DurableExecutionApiClient } from "./durable-execution-api-client";

/**
 * Guards the lazy load of `@aws-sdk/client-lambda`.
 *
 * The rest of this directory's tests mock the AWS SDK, so they would not notice if the
 * dynamic import resolved to a namespace whose shape does not expose the client and
 * command constructors — a real risk, because a dynamic import from CommonJS can place
 * a module's exports under `default` instead of as named exports. This file deliberately
 * does **not** mock the module, so it exercises the real resolution path.
 */
describe("lazy Lambda module resolution", () => {
  it("resolves the real client and command constructors", async () => {
    const apiClient = new DurableExecutionApiClient();

    const { module } = await apiClient.resolveClient();

    expect(typeof module.LambdaClient).toBe("function");
    expect(typeof module.CheckpointDurableExecutionCommand).toBe("function");
    expect(typeof module.GetDurableExecutionStateCommand).toBe("function");
  });

  it("constructs a usable default client without issuing a request", async () => {
    const apiClient = new DurableExecutionApiClient();

    const { client } = await apiClient.resolveClient();

    expect(typeof client.send).toBe("function");
  });
});
