import { LambdaClient } from "@aws-sdk/client-lambda";
import { LocalRunnerStorage } from "./local-runner-storage";

// Mock dependencies
jest.mock("@aws-sdk/client-lambda");

describe("PlaygroundLocalRunnerStorage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (LambdaClient as jest.Mock).mockImplementation(() => ({}));
  });

  test("should initialize with environment variables", () => {
    const originalEnv = process.env;
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    try {
      process.env.DURABLE_LOCAL_RUNNER_ENDPOINT = "https://local-endpoint.com";
      process.env.DURABLE_LOCAL_RUNNER_REGION = "us-west-2";

      new LocalRunnerStorage();

      expect(LambdaClient).toHaveBeenCalledWith({
        endpoint: "https://local-endpoint.com",
        region: "us-west-2",
        credentials: expect.any(Object),
        requestHandler: expect.any(Object),
      });
    } finally {
      process.env = originalEnv;
      consoleSpy.mockRestore();
    }
  });

  test("should handle requests through LocalRunnerSigV4Handler", async () => {
    new LocalRunnerStorage();

    const lambdaClientCall = (LambdaClient as jest.Mock).mock.calls[0][0];
    const handler = lambdaClientCall.requestHandler;

    // Mock the internal signer and httpHandler
    const mockSignedRequest = { signed: true };
    const mockResponse = { response: "test" };

    handler.signer = { sign: jest.fn().mockResolvedValue(mockSignedRequest) };
    handler.httpHandler = { handle: jest.fn().mockResolvedValue(mockResponse) };

    const mockRequest = {
      method: "POST",
      hostname: "test.com",
      path: "/",
      headers: {},
      protocol: "https:",
    };

    const result = await handler.handle(mockRequest);

    expect(handler.signer.sign).toHaveBeenCalledWith(mockRequest);
    expect(handler.httpHandler.handle).toHaveBeenCalledWith(mockSignedRequest);
    expect(result).toBe(mockResponse);
  });
});
