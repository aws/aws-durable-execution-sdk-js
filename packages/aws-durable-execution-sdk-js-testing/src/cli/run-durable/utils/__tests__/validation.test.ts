import { existsSync } from "fs";
import { resolve } from "path";
import * as validation from "../validation";

jest.mock("fs");
jest.mock("path");
jest.mock("url", () => ({
  pathToFileURL: jest.fn((path) => ({ href: `file://${path}` })),
}));

describe("Validation Functions", () => {
  const originalConsoleError = console.error;
  const mockConsoleError = jest.fn();

  const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
  const mockResolve = resolve as jest.MockedFunction<typeof resolve>;

  beforeEach(() => {
    jest.clearAllMocks();
    console.error = mockConsoleError;
    delete process.env.DURABLE_VERBOSE_MODE;
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  describe("validateFilePath", () => {
    beforeEach(() => {
      mockResolve.mockImplementation((cwd, file) => `/resolved/${file}`);
    });

    it("should validate existing file and return absolute path", () => {
      mockExistsSync.mockReturnValue(true);

      const result = validation.validateFilePath("test.js");

      expect(mockResolve).toHaveBeenCalledWith(process.cwd(), "test.js");
      expect(mockExistsSync).toHaveBeenCalledWith("/resolved/test.js");
      expect(result).toBe("/resolved/test.js");
      expect(mockConsoleError).not.toHaveBeenCalled();
    });

    it("should throw error when file does not exist", () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => {
        validation.validateFilePath("nonexistent.js");
      }).toThrow(new Error("Error: File not found: nonexistent.js"));
    });

    it("should handle file paths with spaces", () => {
      mockExistsSync.mockReturnValue(true);
      const fileWithSpaces = "my test file.js";

      const result = validation.validateFilePath(fileWithSpaces);

      expect(mockResolve).toHaveBeenCalledWith(process.cwd(), fileWithSpaces);
      expect(result).toBe("/resolved/my test file.js");
    });

    it("should handle relative paths correctly", () => {
      mockExistsSync.mockReturnValue(true);
      const relativePath = "../other/file.js";

      validation.validateFilePath(relativePath);

      expect(mockResolve).toHaveBeenCalledWith(process.cwd(), relativePath);
      expect(mockExistsSync).toHaveBeenCalledWith("/resolved/../other/file.js");
    });
  });

  describe("setupEnvironment", () => {
    it("should set DURABLE_VERBOSE_MODE when verbose is true", () => {
      delete process.env.DURABLE_VERBOSE_MODE;

      validation.setupEnvironment(true);

      expect(process.env.DURABLE_VERBOSE_MODE).toBe("true");
    });

    it("should not set DURABLE_VERBOSE_MODE when verbose is false", () => {
      delete process.env.DURABLE_VERBOSE_MODE;

      validation.setupEnvironment(false);

      expect(process.env.DURABLE_VERBOSE_MODE).toBeUndefined();
    });

    it("should not modify existing environment variable when verbose is false", () => {
      process.env.DURABLE_VERBOSE_MODE = "existing_value";

      validation.setupEnvironment(false);

      expect(process.env.DURABLE_VERBOSE_MODE).toBe("existing_value");
    });

    it("should overwrite existing environment variable when verbose is true", () => {
      process.env.DURABLE_VERBOSE_MODE = "old_value";

      validation.setupEnvironment(true);

      expect(process.env.DURABLE_VERBOSE_MODE).toBe("true");
    });
  });

  describe("loadAndValidateHandler", () => {
    const mockLoadModuleFromPath = jest.spyOn(validation, "loadModuleFromPath");

    it("should successfully load and validate a handler function", async () => {
      const mockHandler = jest.fn();
      const mockModule = { handler: mockHandler };
      mockLoadModuleFromPath.mockResolvedValue(mockModule);

      const result = await validation.loadAndValidateHandler(
        "/path/to/file.js",
        "handler",
        "file.js",
      );

      expect(mockLoadModuleFromPath).toHaveBeenCalledWith("/path/to/file.js");
      expect(result).toBe(mockHandler);
      expect(mockConsoleError).not.toHaveBeenCalled();
    });

    it("should exit when module is not an object", async () => {
      mockLoadModuleFromPath.mockResolvedValue("not an object");

      await expect(async () => {
        await validation.loadAndValidateHandler(
          "/path/to/file.js",
          "handler",
          "file.js",
        );
      }).rejects.toThrow(
        new Error("Error: Export 'handler' not found in file.js"),
      );
    });

    it("should exit when module is null", async () => {
      mockLoadModuleFromPath.mockResolvedValue(null);

      await expect(async () => {
        await validation.loadAndValidateHandler(
          "/path/to/file.js",
          "handler",
          "file.js",
        );
      }).rejects.toThrow(
        new Error("Error: Export 'handler' not found in file.js"),
      );
    });

    it("should exit when handler export is missing", async () => {
      const mockModule = { otherExport: jest.fn() };
      mockLoadModuleFromPath.mockResolvedValue(mockModule);

      await expect(async () => {
        await validation.loadAndValidateHandler(
          "/path/to/file.js",
          "handler",
          "file.js",
        );
      }).rejects.toThrow(
        new Error("Error: Export 'handler' not found in file.js"),
      );
    });

    it("should exit when handler export is falsy", async () => {
      const mockModule = { handler: null };
      mockLoadModuleFromPath.mockResolvedValue(mockModule);

      await expect(async () => {
        await validation.loadAndValidateHandler(
          "/path/to/file.js",
          "handler",
          "file.js",
        );
      }).rejects.toThrow(
        new Error(
          validation.createErrorMessage([
            "Error: No handler function found in file.js",
            "Expected an export with key handler",
          ]),
        ),
      );
    });

    it("should exit when handler is not a function", async () => {
      const mockModule = { handler: "not a function" };
      mockLoadModuleFromPath.mockResolvedValue(mockModule);

      await expect(async () => {
        await validation.loadAndValidateHandler(
          "/path/to/file.js",
          "handler",
          "file.js",
        );
      }).rejects.toThrow(
        new Error("Error: Handler must be a function, got string"),
      );
    });

    it("should handle custom handler export names", async () => {
      const mockHandler = jest.fn();
      const mockModule = { customHandler: mockHandler };
      mockLoadModuleFromPath.mockResolvedValue(mockModule);

      const result = await validation.loadAndValidateHandler(
        "/path/to/file.js",
        "customHandler",
        "file.js",
      );

      expect(result).toBe(mockHandler);
    });
  });

  describe("createErrorMessage", () => {
    it("should create single line error message", () => {
      const lines = ["Error: Something went wrong"];
      const result = validation.createErrorMessage(lines);

      expect(result).toBe("Error: Something went wrong");
    });

    it("should create multiline error messages correctly", () => {
      const lines = ["Error: Something went wrong", "Additional context"];
      const result = validation.createErrorMessage(lines);

      expect(result).toBe("Error: Something went wrong\nAdditional context");
    });
  });
});
