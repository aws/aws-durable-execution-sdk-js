import * as typescriptParser from "@typescript-eslint/parser";
import { RuleTester } from "eslint";
import { validOperationIdentifiers } from "./valid-operation-identifiers";

const ruleTester = new RuleTester({
  languageOptions: { parser: typescriptParser },
});

const wrap = (body: string) => `
  async function handler(event: any, context: DurableContext) {
    ${body}
  }
`;

describe("valid-operation-identifiers", () => {
  ruleTester.run("valid-operation-identifiers", validOperationIdentifiers, {
    valid: [
      // Printable ASCII names, including spaces and punctuation
      wrap(`await context.step("charge card #1 (retry ok)", async () => 1);`),
      wrap(`await context.wait("pause", { seconds: 1 });`),
      wrap(`await context.map("items", event.items, async (ctx, i) => i);`),
      // 256 characters is the limit
      wrap(`await context.step("${"a".repeat(256)}", async () => 1);`),
      // No name
      wrap(`await context.step(async () => 1);`),
      // A name the code builds at run time is not checked
      wrap(`await context.step(event.name, async () => 1);`),
      wrap("await context.step(`order-${event.id}`, async () => 1);"),
      // invoke's first string can be a function name, so it is not checked
      wrap(`await context.invoke("ü-function", event);`),
      // Valid subtypes
      wrap(
        `await context.step("s", async () => 1, { subType: "Payment_v2-a" });`,
      ),
      wrap(
        `await context.step(async () => 1, { subType: "${"a".repeat(32)}" });`,
      ),
      wrap(`await context.createCallback("cb", { subType: "Approval" });`),
      wrap(
        `await context.runInChildContext("c", async (ctx) => 1, { subType: "Batch" });`,
      ),
      // An empty subType selects the default
      wrap(`await context.step("s", async () => 1, { subType: "" });`),
      // subType is not an option of waitForCallback
      wrap(
        `await context.waitForCallback("w", async () => {}, { subType: "a b" });`,
      ),
      // Calls that are not durable operations
      wrap(`foo("ü");`),
      wrap(`obj["step"]("ü", async () => 1);`),
    ],
    invalid: [
      {
        code: wrap(`await context.step("schritt-ü-步骤", async () => "ok");`),
        errors: [
          {
            messageId: "invalidNameChar",
            data: { char: '"ü" (U+00FC)' },
          },
        ],
      },
      {
        code: wrap(
          "await context.wait(`warten-ä-${event.id}`, { seconds: 1 });",
        ),
        errors: [{ messageId: "invalidNameChar" }],
      },
      {
        code: wrap(`await context.step("tab\\there", async () => 1);`),
        errors: [{ messageId: "invalidNameChar", data: { char: "U+0009" } }],
      },
      {
        code: wrap(`await context.step("${"a".repeat(257)}", async () => 1);`),
        errors: [{ messageId: "nameTooLong", data: { length: "257" } }],
      },
      {
        code: wrap(`await context.runInChildContext("😀", async (ctx) => 1);`),
        errors: [{ messageId: "invalidNameChar" }],
      },
      {
        code: wrap(`await context.createCallback("é");`),
        errors: [{ messageId: "invalidNameChar" }],
      },
      {
        code: wrap(`await context.parallel("ñ", []);`),
        errors: [{ messageId: "invalidNameChar" }],
      },
      {
        code: wrap(
          `await context.step("pay", async () => 1, { subType: "pay ment" });`,
        ),
        errors: [
          { messageId: "invalidSubTypeChar", data: { char: '" " (U+0020)' } },
        ],
      },
      {
        code: wrap(`await context.step(async () => 1, { subType: "a.b" });`),
        errors: [{ messageId: "invalidSubTypeChar" }],
      },
      {
        code: wrap(
          `await context.step(async () => 1, { subType: "${"a".repeat(33)}" });`,
        ),
        errors: [{ messageId: "subTypeTooLong", data: { length: "33" } }],
      },
      {
        code: wrap(`await context.createCallback({ "subType": "ü" });`),
        errors: [{ messageId: "invalidSubTypeChar" }],
      },
      {
        code: wrap(
          "await context.runInChildContext(async (ctx) => 1, { subType: `batch.${event.n}` });",
        ),
        errors: [{ messageId: "invalidSubTypeChar" }],
      },
      {
        // Both the name and the subtype are reported
        code: wrap(
          `await context.step("ü", async () => 1, { subType: "x y" });`,
        ),
        errors: [
          { messageId: "invalidNameChar" },
          { messageId: "invalidSubTypeChar" },
        ],
      },
    ],
  });
});
