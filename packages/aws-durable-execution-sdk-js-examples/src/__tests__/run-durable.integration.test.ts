import { execSync } from "child_process";
import { join } from "path";

const TEST_HANDLER_PATH = join(__dirname, "fixtures/test-handler");

/**
 * Helper function to execute CLI commands and capture output
 */
function runDurableCli(args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execSync(`npx run-durable ${args.join(" ")}`, {
      encoding: "utf8",
      cwd: join(__dirname, "../../../aws-durable-execution-sdk-js-testing"),
      timeout: 30000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      exitCode: error.status || 1,
    };
  }
}

describe.each(["cjs", "mjs"])(
  `run-durable CLI Integration Tests with format=%s`,
  (format) => {
    const testHandlerPath = `${TEST_HANDLER_PATH}.${format}`;

    describe("End-to-End Execution", () => {
      it("should successfully execute test handler end-to-end", () => {
        const { stdout, stderr, exitCode } = runDurableCli([testHandlerPath]);

        expect(stderr).toBe("");

        const lines = stdout.split("\n");
        expect(lines[0]).toContain("Running durable function from");
        expect(lines.slice(1)).toMatchSnapshot();
        expect(exitCode).toBe(0);
      });

      it("should successfully execute with custom handler export", () => {
        const { stdout, stderr, exitCode } = runDurableCli([
          testHandlerPath,
          "--handler-export",
          "customHandler",
        ]);

        expect(stderr).toBe("");
        const lines = stdout.split("\n");
        expect(lines[0]).toContain("Running durable function from");
        expect(lines.slice(1)).toMatchSnapshot();
        expect(exitCode).toBe(0);
      });
    });

    describe("Core Error Cases", () => {
      it("should error when file does not exist", () => {
        const { stdout, stderr, exitCode } = runDurableCli([
          "nonexistent-file.js",
        ]);

        expect(exitCode).toBe(1);
        expect(stdout).toBe("");
        expect(stderr).toMatchSnapshot();
      });

      it("should error when handler export not found", () => {
        const { stdout, stderr, exitCode } = runDurableCli([
          testHandlerPath,
          "--handler-export",
          "nonExistentHandler",
        ]);

        expect(exitCode).toBe(1);
        expect(stdout).toBe("");
        expect(stderr).toContain(
          "Error: Export 'nonExistentHandler' not found in ",
        );
      });
    });
  },
);
