import { LambdaClient } from "@aws-sdk/client-lambda";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { LocalRunnerStorage } from "./local-runner-storage";

// Mock dependencies
jest.mock("@aws-sdk/client-lambda");
jest.mock("@aws-sdk/credential-provider-node", () => ({
  defaultProvider: jest.fn().mockReturnValue(async () => ({
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
  })),
}));

const mockDefaultProvider = defaultProvider as jest.MockedFunction<
  typeof defaultProvider
>;

describe("PlaygroundLocalRunnerStorage", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    (LambdaClient as jest.Mock).mockImplementation(() => ({}));
    mockDefaultProvider.mockReturnValue(async () => ({
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    }));
    // Clear environment variables before each test
    delete process.env.DURABLE_LOCAL_RUNNER_ENDPOINT;
    delete process.env.DURABLE_LOCAL_RUNNER_REGION;
    delete process.env.DURABLE_LOCAL_RUNNER_CREDENTIALS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("should initialize with environment variables", () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    try {
      process.env.DURABLE_LOCAL_RUNNER_ENDPOINT = "https://local-endpoint.com";
      process.env.DURABLE_LOCAL_RUNNER_REGION = "us-west-2";

      new LocalRunnerStorage();

      expect(LambdaClient).toHaveBeenCalledWith({
        endpoint: "https://local-endpoint.com",
        region: "us-west-2",
        credentials: expect.any(Function),
        requestHandler: expect.any(Object),
      });
    } finally {
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

  test("should use credentials from DURABLE_LOCAL_RUNNER_CREDENTIALS environment variable", () => {
    const customCredentials = {
      accessKeyId: "custom-access-key",
      secretAccessKey: "custom-secret-key",
      sessionToken: "custom-session-token",
    };

    process.env.DURABLE_LOCAL_RUNNER_CREDENTIALS =
      JSON.stringify(customCredentials);

    new LocalRunnerStorage();

    expect(LambdaClient).toHaveBeenCalledWith({
      credentials: customCredentials,
      endpoint: undefined,
      region: undefined,
      requestHandler: expect.any(Object),
    });

    // Verify that defaultProvider was not called when custom credentials are provided
    expect(mockDefaultProvider).not.toHaveBeenCalled();
  });

  test("should use defaultProvider when DURABLE_LOCAL_RUNNER_CREDENTIALS is not set", () => {
    new LocalRunnerStorage();

    const lambdaClientCall = (LambdaClient as jest.Mock).mock.calls[0][0];
    expect(lambdaClientCall.credentials).toEqual(expect.any(Function));
    expect(mockDefaultProvider).toHaveBeenCalled();
  });

  test("should pass credentials to LocalRunnerSigV4Handler", () => {
    const customCredentials = {
      accessKeyId: "handler-access-key",
      secretAccessKey: "handler-secret-key",
    };

    process.env.DURABLE_LOCAL_RUNNER_CREDENTIALS =
      JSON.stringify(customCredentials);

    new LocalRunnerStorage();

    const lambdaClientCall = (LambdaClient as jest.Mock).mock.calls[0][0];
    const handler = lambdaClientCall.requestHandler;

    // Verify that the handler was constructed and has the expected properties
    expect(handler).toBeDefined();
    expect(handler.signer).toBeDefined();
    expect(handler.httpHandler).toBeDefined();

    // The handler should have been constructed with the same credentials
    // We can verify this by checking that the signer's credentialProvider is set
    expect(typeof handler.signer.credentialProvider).toBe("function");
  });

  test("should throw error for invalid JSON in DURABLE_LOCAL_RUNNER_CREDENTIALS", () => {
    process.env.DURABLE_LOCAL_RUNNER_CREDENTIALS = "invalid-json";

    expect(() => {
      new LocalRunnerStorage();
    }).toThrow();
  });
});
