import tseslint from "typescript-eslint";

/**
 * Modules that belong to exactly one host. Shared code must import none of them,
 * and each host may import only its own.
 *
 * This list mirrors `HOST_MODULES` in
 * `packages/durable-insight-core/src/hostModuleScan.ts`, which is where the tested,
 * authoritative version lives. It is restated here because a flat eslint config
 * cannot import from a workspace package that has no build output.
 */
const HOST_MODULES = {
  vscode: "vscode",
  electron: "electron",
  mcpSdk: "@modelcontextprotocol/sdk",
};

/**
 * Builds a `no-restricted-imports` config forbidding every host module except the
 * one this package legitimately owns, plus the cross-package relative import that
 * this whole refactor exists to prevent.
 */
function boundaryRule(ownHostModule) {
  const forbidden = Object.values(HOST_MODULES).filter(
    (m) => m !== ownHostModule,
  );
  return [
    "error",
    {
      paths: forbidden.map((name) => ({
        name,
        message:
          `"${name}" belongs to a different host process and is not available here. ` +
          `Shared, host-free code belongs in @aws/durable-insight-core; express what ` +
          `you need through the HostPort interface and let each host implement it.`,
      })),
      patterns: [
        // Subpaths of another host's module (the MCP SDK is only ever imported this
        // way, so a bare `paths` entry would miss every real usage).
        ...forbidden.map((name) => ({
          group: [`${name}/*`],
          message: `"${name}" belongs to a different host process and is not available here.`,
        })),
        {
          group: ["../../*"],
          message:
            "Do not reach into a sibling package by relative path. Depend on it " +
            "(e.g. `@aws/durable-insight-core`) and import by name, so the " +
            "dependency is declared and the boundary is real.",
        },
      ],
    },
  ];
}

export default [
  {
    ignores: [
      "**/coverage/**",
      "**/node_modules/**",
      "**/dist/**",
      // Build outputs, not sources. Without these, `eslint .` lints generated
      // JavaScript that carries `eslint-disable` comments for rules this config does
      // not enable, and fails with "Definition for rule ... was not found".
      "**/dist-cjs/**",
      "**/.rollup.cache/**",
      "**/build/**",
    ],
  },

  /**
   * Structural rules for the Workflow Insight packages.
   *
   * These exist because the alternative is a convention nobody can enforce. The
   * refactor that created `@aws/durable-insight-core` was motivated by a
   * cross-package relative import that had grown up unnoticed, and review then
   * showed that a host-specific import in shared code was equally invisible: an
   * `electron` import in a core module that no test happened to cover passed every
   * check and every build.
   *
   * NOTE ON ENFORCEMENT: eslint currently runs only through lint-staged on
   * pre-commit, which `--no-verify` bypasses, and there is no lint job in CI. So
   * treat these rules as the earliest and most convenient signal -- they surface in
   * the editor while you type -- and NOT as the enforcement mechanism. The
   * `hostAgnostic.test.ts` guards are what run on every pull request, and they must
   * stay.
   */
  ...[
    // package glob                                          own host module
    ["packages/durable-insight-core/**/*.ts", null],
    ["packages/durable-insight-mcp/**/*.ts", HOST_MODULES.mcpSdk],
    [
      "packages/aws-durable-execution-sdk-js-insight-vscode/**/*.{ts,tsx}",
      HOST_MODULES.vscode,
    ],
    [
      "packages/aws-durable-execution-sdk-js-insight-desktop/**/*.ts",
      HOST_MODULES.electron,
    ],
  ].map(([files, ownHostModule]) => ({
    files: [files],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { sourceType: "module" },
    },
    /**
     * The plugin is registered but its rules are NOT enabled. Registering it is what
     * makes existing `// eslint-disable-next-line @typescript-eslint/...` comments in
     * these packages resolve; without it eslint reports "Definition for rule ... was
     * not found" and fails on a clean tree. Enabling the recommended set is a
     * separate, larger decision for the whole repository.
     */
    plugins: { "@typescript-eslint": tseslint.plugin },
    /**
     * Do not report (and therefore do not let `--fix` delete) the existing
     * `eslint-disable` comments in these packages. Because the plugin's rules are
     * registered but off, those directives suppress nothing today and eslint would
     * flag them as unused -- and lint-staged runs `eslint --fix`, which would
     * silently strip them from source on the next commit that touched the file.
     */
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: { "no-restricted-imports": boundaryRule(ownHostModule) },
  })),
];
