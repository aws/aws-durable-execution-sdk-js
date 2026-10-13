/**
 * Lints real code with the plugin through ESLint's public API, using whichever
 * ESLint version is installed.
 *
 * The plugin's peer range is ESLint ^8.57.0 || ^9.0.0 || ^10.0.0. The
 * RuleTester suites run only on the version the repository installs (10),
 * because RuleTester takes a different config format in ESLint 8. This suite
 * uses the flat config format, which every version in the peer range accepts.
 * The "eslint-plugin-compat" job in .github/workflows/build.yml installs the
 * latest ESLint 8 (8.57) and the latest 9 and runs this file against each.
 */
import * as path from "node:path";
import * as typescriptParser from "@typescript-eslint/parser";
import plugin from "./index";

// biome-ignore lint/style/noCommonJs: the installed ESLint version decides which module to load
const eslintModule = require("eslint");
// biome-ignore lint/style/noCommonJs: the installed ESLint version decides which module to load
const { version: eslintVersion } = require("eslint/package.json");
const eslintMajor = Number(eslintVersion.split(".")[0]);

/**
 * ESLint 9 and later use flat config in the `ESLint` class. ESLint 8.57 has
 * the same implementation under a different name.
 */
function createLinter(overrideConfig: unknown[]) {
  const Linter =
    eslintMajor >= 9
      ? eslintModule.ESLint
      : // biome-ignore lint/style/noCommonJs: see above
        require("eslint/use-at-your-own-risk").FlatESLint;
  return new Linter({
    cwd: __dirname,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ["**/*.ts"], languageOptions: { parser: typescriptParser } },
      ...overrideConfig,
    ],
  });
}

async function lint(code: string, overrideConfig: unknown[]) {
  const [result] = await createLinter(overrideConfig).lintText(code, {
    filePath: path.join(__dirname, "sample.ts"),
  });
  return result.messages;
}

/** Breaks all three rules. */
const VIOLATING = `
export const handler = async (event: any, context: any) => {
  const startedAt = Date.now();
  let counter = 0;
  await context.step(async () => {
    counter++;
    await context.wait({ seconds: 1 });
    return startedAt;
  });
};
`;

/** The same workflow, written the way the rules ask for. */
const CLEAN = `
export const handler = async (event: any, context: any) => {
  const startedAt = await context.step(async () => Date.now());
  await context.wait({ seconds: 1 });
  const counter = await context.step(async () => {
    let local = 0;
    local++;
    return local;
  });
  return { startedAt, counter };
};
`;

const NAMESPACE = "@aws/durable-functions";

describe(`plugin on ESLint ${eslintVersion}`, () => {
  describe('configs["flat/recommended"]', () => {
    const config = [plugin.configs["flat/recommended"]];

    it("reports every rule on code that breaks them", async () => {
      const messages = await lint(VIOLATING, config);

      expect(messages.filter((m) => m.fatal)).toEqual([]);
      expect(new Set(messages.map((m) => m.ruleId))).toEqual(
        new Set([
          `${NAMESPACE}/no-nested-durable-operations`,
          `${NAMESPACE}/no-closure-in-durable-operations`,
          `${NAMESPACE}/no-non-deterministic-outside-step`,
        ]),
      );
      expect(messages.every((m) => m.severity === 2)).toBe(true);
    });

    it("reports nothing on code that follows the rules", async () => {
      expect(await lint(CLEAN, config)).toEqual([]);
    });

    it("honors an eslint-disable comment that names the rule", async () => {
      const code = `
export const handler = async (event: any, context: any) => {
  await context.step(async () => {
    // eslint-disable-next-line ${NAMESPACE}/no-nested-durable-operations
    await context.wait({ seconds: 1 });
  });
};
`;
      expect(await lint(code, config)).toEqual([]);
    });
  });

  describe("registering the plugin by hand", () => {
    it("works under a namespace the user chooses", async () => {
      const messages = await lint(VIOLATING, [
        {
          files: ["**/*.ts"],
          plugins: { durable: plugin },
          rules: { "durable/no-nested-durable-operations": "error" },
        },
      ]);

      expect(messages.map((m) => m.ruleId)).toEqual([
        "durable/no-nested-durable-operations",
      ]);
    });
  });
});
