import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { getCredentialsProvider } from "./credentials-provider";

// Mock the AWS SDK default provider
jest.mock("@aws-sdk/credential-provider-node", () => ({
  defaultProvider: jest.fn(),
}));

describe("credentials-provider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    // Reset environment variables
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe("getCredentialsProvider", () => {
    test("should return test credentials when DURABLE_LOCAL_MODE is true", async () => {
      // Set local mode environment variable
      process.env.DURABLE_LOCAL_MODE = "true";

      // Get the credentials provider
      const credentialsProvider = getCredentialsProvider();

      // Call the provider function to get credentials
      const credentials = await credentialsProvider();

      // Verify test credentials are returned
      expect(credentials).toEqual({
        accessKeyId: "placeholder-accessKeyId",
        secretAccessKey: "placeholder-secretAccessKey",
        sessionToken: "placeholder-sessionToken",
      });

      // Verify defaultProvider was not called
      expect(defaultProvider).not.toHaveBeenCalled();
    });

    test.each(["false", "", "some-other-value", undefined])(
      "should return default provider when DURABLE_LOCAL_MODE is %s",
      (value) => {
        // Set local mode environment variable to value
        process.env.DURABLE_LOCAL_MODE = value;

        // Mock the default provider
        const mockDefaultProvider = jest.fn();
        (defaultProvider as jest.Mock).mockReturnValue(mockDefaultProvider);

        // Get the credentials provider
        const credentialsProvider = getCredentialsProvider();

        // Verify defaultProvider was called
        expect(defaultProvider).toHaveBeenCalled();

        // Verify the returned provider is the mocked default provider
        expect(credentialsProvider).toBe(mockDefaultProvider);
      },
    );
  });
});
