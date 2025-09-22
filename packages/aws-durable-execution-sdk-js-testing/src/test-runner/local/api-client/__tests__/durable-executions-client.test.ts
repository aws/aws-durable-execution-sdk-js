import {
  getDurableExecutionsClient,
  resetDurableExecutionsClient,
} from "../durable-executions-client";
import { LambdaClient } from "@aws-sdk/client-lambda";

// Mock the LambdaClient
jest.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: jest.fn(),
}));

describe("getDurableExecutionsClient", () => {
  const mockClient = {} as LambdaClient;
  let mockLambdaClient: jest.MockedClass<
    typeof LambdaClient
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLambdaClient = LambdaClient as jest.MockedClass<
      typeof LambdaClient
    >;
    mockLambdaClient.mockImplementation(() => mockClient);
  });

  afterEach(() => {
    // Clear the singleton instance between tests
    jest.resetModules();
    resetDurableExecutionsClient();
    delete process.env.DEX_ENDPOINT;
  });

  it("should return the same instance on multiple calls", () => {
    const client1 = getDurableExecutionsClient();
    const client2 = getDurableExecutionsClient();

    expect(client1).toBe(client2);
    expect(client1).toBe(mockClient);
    expect(mockLambdaClient).toHaveBeenCalledTimes(1);
  });

  it("should initialize client with mock credentials and endpoint from environment", () => {
    process.env.DEX_ENDPOINT = "https://test-endpoint.example.com";

    getDurableExecutionsClient();

    expect(mockLambdaClient).toHaveBeenCalledWith({
      credentials: {
        secretAccessKey: "mock-secretAccessKey",
        accessKeyId: "mock-accessKeyId",
      },
      region: "us-east-1",
      endpoint: "https://test-endpoint.example.com",
    });
  });
});
