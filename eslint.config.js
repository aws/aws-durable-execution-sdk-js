import tseslint from "typescript-eslint";

/**
 * Packages that make up Workflow Insight. These are linted with the rules below;
 * the rest of the repository is unaffected, since flat config only applies a block
 * to the files its `files` globs match.
 */
const INSIGHT_PACKAGES = [
  "packages/durable-insight-core/**/*.ts",
  "packages/aws-durable-execution-sdk-js-insight-vscode/**/*.{ts,tsx}",
  "packages/aws-durable-execution-sdk-js-insight-desktop/**/*.ts",
];

export default [
  {
    ignores: [
      "**/coverage/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
    ],
  },

  /**
   * Structural rules for the Workflow Insight packages.
   *
   * These exist because the alternative is a convention nobody can enforce. The
   * refactor that created `@aws/durable-insight-core` was motivated by a
   * cross-package relative import that had grown up unnoticed; a one-time cleanup
   * does not stop the next one.
   *
   * NOTE ON ENFORCEMENT: eslint currently runs only through lint-staged on
   * pre-commit, which `--no-verify` bypasses, and there is no lint job in CI. So
   * treat these rules as the earliest and most convenient signal -- they surface in
   * the editor while you type -- and NOT as the enforcement mechanism. The tests
   * (`hostAgnostic.test.ts` in core and in the desktop package) are what run on
   * every pull request, and they must stay.
   */
  {
    files: INSIGHT_PACKAGES,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { sourceType: "module" },
    },
    /**
     * The plugin is registered but its rules are NOT enabled. Registering it is
     * what makes existing `// eslint-disable-next-line @typescript-eslint/...`
     * comments in these packages resolve; without it, eslint reports "Definition
     * for rule ... was not found" and fails on a clean tree. Enabling the full
     * recommended set is a separate, larger decision for the whole repository.
     */
    plugins: { "@typescript-eslint": tseslint.plugin },
    /**
     * Do not report (and therefore do not let `--fix` delete) the existing
     * `eslint-disable` comments in these packages. Because the plugin's rules are
     * registered but off, those directives suppress nothing today and eslint would
     * flag them as unused -- and lint-staged runs `eslint --fix`, which would
     * silently strip them from source on the next commit that touched the file.
     * They are correct annotations of genuinely unusual code and should survive
     * until someone deliberately enables the rules.
     */
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../*"],
              message:
                "Do not reach into a sibling package by relative path. Depend on it " +
                "(e.g. `@aws/durable-insight-core`) and import by name, so the " +
                "dependency is declared and the boundary is real.",
            },
          ],
        },
      ],
    },
  },

  /**
   * The core package must stay host-free: the Electron and MCP hosts have no VS
   * Code extension API, so a single `vscode` import here breaks them at runtime,
   * possibly only on a path nobody exercises during review.
   *
   * `hostAgnostic.test.ts` is the guard that actually runs in CI. This rule just
   * says so sooner.
   */
  {
    files: ["packages/durable-insight-core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "vscode",
              message:
                "durable-insight-core must be host-free. Code needing the VS Code " +
                "API belongs in aws-durable-execution-sdk-js-insight-vscode; " +
                "express what you need through the HostPort interface instead.",
            },
          ],
          patterns: [
            {
              group: ["../../*"],
              message:
                "Do not reach into a sibling package by relative path. Depend on it " +
                "and import by name.",
            },
          ],
        },
      ],
    },
  },
];
