import { createCliProgram, parseCliArgs } from "../cli-config";

describe("CLI Configuration", () => {
  // Mock process.argv to control CLI parsing
  const originalArgv = process.argv;

  beforeAll(() => {
    process.env.NPM_PACKAGE_VERSION = "1.0.0";
  });

  afterAll(() => {
    delete process.env.NPM_PACKAGE_VERSION;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  describe("createCliProgram", () => {
    it("should create program with correct name and description", () => {
      const program = createCliProgram();

      expect(program.name()).toBe("run-durable");
      expect(program.description()).toBe(
        "Run a durable function locally for testing",
      );
    });

    it("should use environment version", () => {
      // Test with environment variable
      process.env.NPM_PACKAGE_VERSION = "2.0.0";
      const programWithEnv = createCliProgram();
      expect(programWithEnv.version()).toBe("2.0.0");
    });
  });

  describe("parseCliArgs", () => {
    it("should parse basic file argument with defaults", () => {
      process.argv = ["node", "run-durable", "test.js"];

      const result = parseCliArgs();

      expect(result.filePath).toBe("test.js");
      expect(result.options.skipTime).toBe(false);
      expect(result.options.verbose).toBe(false);
      expect(result.options.showHistory).toBe(false);
      expect(result.options.handlerExport).toBe("handler");
    });

    it("should parse all options correctly", () => {
      process.argv = [
        "node",
        "run-durable",
        "test.js",
        "--skip-time",
        "--verbose",
        "--show-history",
        "--handler-export",
        "customHandler",
      ];

      const result = parseCliArgs();

      expect(result.filePath).toBe("test.js");
      expect(result.options.skipTime).toBe(true);
      expect(result.options.verbose).toBe(true);
      expect(result.options.showHistory).toBe(true);
      expect(result.options.handlerExport).toBe("customHandler");
    });

    it("should handle short flags", () => {
      process.argv = ["node", "run-durable", "test.js", "-v"];

      const result = parseCliArgs();

      expect(result.options.verbose).toBe(true);
      expect(result.options.skipTime).toBe(false);
      expect(result.options.showHistory).toBe(false);
    });

    it("should parse mixed argument orders", () => {
      process.argv = [
        "node",
        "run-durable",
        "--verbose",
        "test.js",
        "--skip-time",
      ];

      const result = parseCliArgs();

      expect(result.filePath).toBe("test.js");
      expect(result.options.verbose).toBe(true);
      expect(result.options.skipTime).toBe(true);
    });
  });
});
