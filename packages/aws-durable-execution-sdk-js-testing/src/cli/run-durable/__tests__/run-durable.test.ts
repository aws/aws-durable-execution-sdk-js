import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  type MockedFunction,
  type MockedClass,
} from "vitest";
import { LocalDurableTestRunner } from "../../../";
import { parseCliArgs } from "../utils/cli-config";
import { loadAndValidateHandler } from "../utils/validation";
import { runDurable } from "../run-durable";

// Mock only the essential dependencies
vi.mock("../utils/cli-config");
vi.mock("../utils/validation");
vi.mock("../utils/output");
vi.mock("../../../", () => ({
  // biome-ignore lint/complexity/useArrowFunction: used with `new`, so it must be a constructible function
  LocalDurableTestRunner: vi.fn().mockImplementation(function () {
    return {
      run: vi.fn().mockResolvedValue({
        print: vi.fn(),
        getStatus: vi.fn().mockReturnValue("SUCCEEDED"),
      }),
    };
  }),
}));

// Mocks for the main functions
const mockParseCliArgs = parseCliArgs as MockedFunction<typeof parseCliArgs>;
const mockLoadAndValidateHandler = loadAndValidateHandler as MockedFunction<
  typeof loadAndValidateHandler
>;

// Mock static methods
const MockedLocalDurableTestRunner = LocalDurableTestRunner as MockedClass<
  typeof LocalDurableTestRunner
>;
MockedLocalDurableTestRunner.setupTestEnvironment = vi.fn();
MockedLocalDurableTestRunner.teardownTestEnvironment = vi.fn();

describe("runDurable orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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

    mockLoadAndValidateHandler.mockResolvedValue(vi.fn());
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
