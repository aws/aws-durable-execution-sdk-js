import { LambdaClient } from "@amzn/dex-internal-sdk";
import { PlaygroundLocalRunnerStorage } from "./local-runner-storage";
import { getCredentialsProvider } from "./credentials-provider";

// Mock dependencies
jest.mock("@amzn/dex-internal-sdk");
jest.mock("./credentials-provider");

describe("PlaygroundLocalRunnerStorage", () => {
  const mockCredentials = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (getCredentialsProvider as jest.Mock).mockReturnValue(mockCredentials);
    (LambdaClient as jest.Mock).mockImplementation(() => ({}));
  });

  test("should initialize with environment variables", () => {
    const originalEnv = process.env;
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    try {
      process.env.LOCAL_RUNNER_ENDPOINT = "https://local-endpoint.com";
      process.env.LOCAL_RUNNER_REGION = "us-west-2";

      new PlaygroundLocalRunnerStorage();

      expect(consoleSpy).toHaveBeenCalledWith(
        "Initializing local runner DAR client with endpoint: https://local-endpoint.com, region: us-west-2",
      );
      expect(LambdaClient).toHaveBeenCalledWith({
        endpoint: "https://local-endpoint.com",
        region: "us-west-2",
        credentials: mockCredentials,
        requestHandler: expect.any(Object),
      });
    } finally {
      process.env = originalEnv;
      consoleSpy.mockRestore();
    }
  });

  test("should handle requests through LocalRunnerSigV4Handler", async () => {
    new PlaygroundLocalRunnerStorage();

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
