import { setCustomStorage, getExecutionState } from "./storage";
import { ApiStorage } from "./api-storage";

// Mock ApiStorage and LambdaClient
jest.mock("./api-storage");
jest.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({})),
}));

describe("storage", () => {
  beforeEach(() => {
    // Reset custom storage before each test
    setCustomStorage(undefined as any);
  });

  describe("getExecutionState", () => {
    it("should return ApiStorage when no custom storage is set", () => {
      const result = getExecutionState();
      expect(result).toBeInstanceOf(ApiStorage);
    });

    it("should return custom storage when set", () => {
      const mockStorage = {
        checkpoint: jest.fn(),
        getStepData: jest.fn(),
      };

      setCustomStorage(mockStorage);
      const result = getExecutionState();

      expect(result).toBe(mockStorage);
    });
  });

  describe("setCustomStorage", () => {
    it("should set custom storage", () => {
      const mockStorage = {
        checkpoint: jest.fn(),
        getStepData: jest.fn(),
      };

      setCustomStorage(mockStorage);
      const result = getExecutionState();

      expect(result).toBe(mockStorage);
    });
  });
});
