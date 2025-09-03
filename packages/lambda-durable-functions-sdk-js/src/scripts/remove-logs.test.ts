import { removeLogCallsAST, removeLogImportsAST } from "./remove-logs";

describe("Selective Log Removal", () => {
  describe("removeLogCallsAST", () => {
    it("should remove log calls from our logger module", () => {
      const input = `
import { log } from "./utils/logger/logger";
import { otherFunction } from "./other";

console.log("This should stay");
log(context.isVerbose, "🔄", "This should be removed");
const result = "test";
`;

      const result = removeLogCallsAST(input, "test.ts");

      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain('console.log("This should stay")');
      expect(result.code).not.toContain("log(context.isVerbose");
    });

    it("should NOT remove console.log calls", () => {
      const input = `
import { otherFunction } from "./other";

console.log("This should stay");
const result = "test";
`;

      const result = removeLogCallsAST(input, "test.ts");

      expect(result.hasChanges).toBe(false);
      expect(result.code).toContain('console.log("This should stay")');
    });

    it("should NOT remove log calls from other libraries", () => {
      const input = `
import { log } from "some-other-library";
import { otherFunction } from "./other";

log("This should stay - it's from another library");
const result = "test";
`;

      const result = removeLogCallsAST(input, "test.ts");

      expect(result.hasChanges).toBe(false);
      expect(result.code).toContain(
        'log("This should stay - it\'s from another library")',
      );
    });

    it("should handle mixed imports correctly", () => {
      const input = `
import { log } from "./utils/logger/logger";
import { log as otherLog } from "other-library";

otherLog("This should stay");
log(context.isVerbose, "🔄", "This should be removed");
const result = "test";
`;

      const result = removeLogCallsAST(input, "test.ts");

      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain('otherLog("This should stay")');
      expect(result.code).not.toContain("log(context.isVerbose");
    });

    it("should handle aliased imports from our logger", () => {
      const input = `
import { log as myLog } from "./utils/logger/logger";

console.log("This should stay");
myLog(context.isVerbose, "🔄", "This should be removed");
const result = "test";
`;

      const result = removeLogCallsAST(input, "test.ts");

      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain('console.log("This should stay")');
      expect(result.code).not.toContain("myLog(context.isVerbose");
    });

    it("should handle multi-line log calls", () => {
      const input = `
import { log } from "./utils/logger/logger";

log(
  context.isVerbose,
  "🔄",
  "This should be removed",
  { data: "complex" }
);
const result = "test";
`;

      const result = removeLogCallsAST(input, "test.ts");

      expect(result.hasChanges).toBe(true);
      expect(result.code).not.toContain("log(");
      expect(result.code).toContain('const result = "test"');
    });

    it("should not remove log mentions in strings", () => {
      const input = `
import { log } from "./utils/logger/logger";

const message = "This log() call should stay in string";
log(context.isVerbose, "🔄", "But this should go");
`;

      const result = removeLogCallsAST(input, "test.ts");

      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain("This log() call should stay in string");
      expect(result.code).not.toContain("log(context.isVerbose");
    });
  });

  describe("removeLogImportsAST", () => {
    it("should remove log import from our logger module", () => {
      const input = `
import { log } from "./utils/logger/logger";
import { otherFunction } from "./other";
`;

      const result = removeLogImportsAST(input, "test.ts");

      expect(result.hasChanges).toBe(true);
      expect(result.code).not.toContain("import { log }");
      expect(result.code).toContain("import { otherFunction }");
    });

    it("should handle multiple imports from logger module", () => {
      const input = `
import { log, otherLoggerFunction } from "./utils/logger/logger";

otherLoggerFunction("This should stay");
`;

      const result = removeLogImportsAST(input, "test.ts");

      expect(result.hasChanges).toBe(true);
      expect(result.code).toContain("import { otherLoggerFunction }");
      expect(result.code).not.toContain("log,");
    });

    it("should remove entire import if log is the only import", () => {
      const input = `
import { log } from "./utils/logger/logger";
import { otherFunction } from "./other";
`;

      const result = removeLogImportsAST(input, "test.ts");

      expect(result.hasChanges).toBe(true);
      expect(result.code).not.toContain("logger/logger");
      expect(result.code).toContain("import { otherFunction }");
    });

    it("should handle aliased log imports", () => {
      const input = `
import { log as myLog } from "./utils/logger/logger";
import { otherFunction } from "./other";
`;

      const result = removeLogImportsAST(input, "test.ts");

      expect(result.hasChanges).toBe(true);
      expect(result.code).not.toContain("logger/logger");
      expect(result.code).toContain("import { otherFunction }");
    });

    it("should NOT remove log imports from other libraries", () => {
      const input = `
import { log } from "some-other-library";
import { otherFunction } from "./other";
`;

      const result = removeLogImportsAST(input, "test.ts");

      expect(result.hasChanges).toBe(false);
      expect(result.code).toContain('import { log } from "some-other-library"');
    });
  });

  describe("Integration tests", () => {
    it("should handle complete log removal workflow", () => {
      const input = `
import { log, otherLoggerFunction } from "./utils/logger/logger";
import { someUtil } from "./utils";

someUtil();
otherLoggerFunction("This should stay");
log(context.isVerbose, "🔄", "This should be removed");
const result = "test";
`;

      // First remove log calls
      const logResult = removeLogCallsAST(input, "test.ts");

      // Then remove log imports
      const importResult = removeLogImportsAST(logResult.code, "test.ts");

      expect(logResult.hasChanges).toBe(true);
      expect(importResult.hasChanges).toBe(true);

      const finalCode = importResult.code;
      expect(finalCode).toContain("import { otherLoggerFunction }");
      expect(finalCode).toContain("import { someUtil }");
      expect(finalCode).toContain('otherLoggerFunction("This should stay")');
      expect(finalCode).not.toContain("log(context.isVerbose");
      expect(finalCode).not.toContain("log,");
    });

    it("should handle files without our logger imports", () => {
      const input = `
import { someUtil } from "./utils";
import { log } from "other-library";

someUtil();
log("This should stay");
console.log("This should also stay");
`;

      const logResult = removeLogCallsAST(input, "test.ts");
      const importResult = removeLogImportsAST(logResult.code, "test.ts");

      expect(logResult.hasChanges).toBe(false);
      expect(importResult.hasChanges).toBe(false);

      expect(importResult.code).toContain('log("This should stay")');
      expect(importResult.code).toContain(
        'console.log("This should also stay")',
      );
    });
  });
});
