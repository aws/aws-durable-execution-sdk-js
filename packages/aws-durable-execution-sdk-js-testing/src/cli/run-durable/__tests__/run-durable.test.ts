import { LocalDurableTestRunner } from "../../../";
import { parseCliArgs } from "../utils/cli-config";
import { loadAndValidateHandler } from "../utils/validation";
import { runDurable } from "../run-durable";

// Mock only the essential dependencies
jest.mock("../utils/cli-config");
jest.mock("../utils/validation");
jest.mock("../utils/output");
jest.mock("../../../", () => ({
  LocalDurableTestRunner: jest.fn().mockImplementation(() => ({
    run: jest.fn().mockResolvedValue({
      print: jest.fn(),
      getStatus: jest.fn().mockReturnValue("SUCCEEDED"),
    }),
  })),
}));

// Mocks for the main functions
const mockParseCliArgs = parseCliArgs as jest.MockedFunction<
  typeof parseCliArgs
>;
const mockLoadAndValidateHandler =
  loadAndValidateHandler as jest.MockedFunction<typeof loadAndValidateHandler>;

// Mock static methods
const MockedLocalDurableTestRunner = LocalDurableTestRunner as jest.MockedClass<
  typeof LocalDurableTestRunner
>;
MockedLocalDurableTestRunner.setupTestEnvironment = jest.fn();
MockedLocalDurableTestRunner.teardownTestEnvironment = jest.fn();

describe("runDurable orchestration", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup minimal default mocks
    mockParseCliArgs.mockReturnValue({
      filePath: "test.js",
      options: {
        skipTime: false,
        verbose: false,
        showHistory: false,
        handlerExport: "handler",
      },
    });

    mockLoadAndValidateHandler.mockResolvedValue(jest.fn());
  });

  it("should run the CLI workflow successfully", async () => {
    await runDurable();

    // Test that main functions are called
    expect(mockParseCliArgs).toHaveBeenCalled();
    expect(mockLoadAndValidateHandler).toHaveBeenCalled();
    expect(
      MockedLocalDurableTestRunner.setupTestEnvironment,
    ).toHaveBeenCalled();
    expect(
      MockedLocalDurableTestRunner.teardownTestEnvironment,
    ).toHaveBeenCalled();
  });

  it("should handle different CLI options", async () => {
    mockParseCliArgs.mockReturnValue({
      filePath: "custom.js",
      options: {
        skipTime: true,
        verbose: true,
        showHistory: true,
        handlerExport: "customHandler",
      },
    });

    await runDurable();

    // Verify it processes different options without error
    expect(mockParseCliArgs).toHaveBeenCalled();
    expect(mockLoadAndValidateHandler).toHaveBeenCalled();
  });
});
