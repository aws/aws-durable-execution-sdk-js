import {
  LambdaClient,
  CheckpointDurableExecutionCommand,
  GetDurableExecutionStateCommand,
} from "@aws-sdk/client-lambda";
import { DurableExecutionApiClient } from "./durable-execution-api-client";
import {
  loadLambdaModule,
  resolveDefaultLambdaClient,
  type LambdaModule,
} from "./lambda-module";

jest.mock("./lambda-module", () => ({
  loadLambdaModule: jest.fn(),
  resolveDefaultLambdaClient: jest.fn(),
}));

const moduleValue: LambdaModule = {
  LambdaClient,
  CheckpointDurableExecutionCommand,
  GetDurableExecutionStateCommand,
};
const params = { DurableExecutionArn: "arn", CheckpointToken: "token" };

describe.each(["checkpoint", "getExecutionState"] as const)(
  "%s invocation cancellation",
  (method) => {
    beforeEach(() => jest.clearAllMocks());

    it("passes the invocation signal to send without destroying the shared client", async () => {
      jest.mocked(loadLambdaModule).mockResolvedValue(moduleValue);
      const send = jest.fn<Promise<object>, [unknown, unknown?]>(
        async () => ({}),
      );
      const destroy = jest.fn();
      const client = { send, destroy } as unknown as LambdaClient;
      jest.mocked(resolveDefaultLambdaClient).mockResolvedValue(client);
      const controller = new AbortController();
      await new DurableExecutionApiClient()[method](params, undefined, {
        abortSignal: controller.signal,
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][1]).toEqual({ abortSignal: controller.signal });
      expect(destroy).not.toHaveBeenCalled();
    });

    it("does not send if cancellation happens during lazy module loading", async () => {
      let release!: (value: LambdaModule) => void;
      jest.mocked(loadLambdaModule).mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const send = jest.fn<Promise<object>, [unknown, unknown?]>(
        async () => ({}),
      );
      const destroy = jest.fn();
      const client = { send, destroy } as unknown as LambdaClient;
      jest.mocked(resolveDefaultLambdaClient).mockResolvedValue(client);
      const controller = new AbortController();
      const request = new DurableExecutionApiClient()[method](
        params,
        undefined,
        { abortSignal: controller.signal },
      );
      controller.abort();
      release(moduleValue);
      await expect(request).rejects.toBe(controller.signal.reason);
      expect(send).not.toHaveBeenCalled();
    });
  },
);
