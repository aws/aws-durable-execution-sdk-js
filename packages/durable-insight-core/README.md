# @aws/durable-insight-core

The host-free core of Workflow Insight: everything that queries a destination,
understands the record schema, and keeps queries safe — with no dependency on any
particular UI or runtime.

It exists so the hosts can share one implementation instead of copying it.

```
                 ┌──────────────────────────────────┐
                 │    @aws/durable-insight-core     │
                 │  data access · schema · safety   │
                 │  configCore · destinationTest    │
                 └──────────────────────────────────┘
                     ▲              ▲
        ┌────────────┘              └────────────┐
┌───────┴────────────┐            ┌──────────────┴─────┐
│ …-insight-vscode   │            │ …-insight-desktop  │
│ VS Code extension  │            │ Electron app       │
└────────────────────┘            └────────────────────┘
```

## The one rule

**Nothing in this package may import a host-specific module.**

There are three, one per host, and each exists in only one process:

| Module                      | Only available in          |
| --------------------------- | -------------------------- |
| `vscode`                    | the VS Code extension host |
| `electron`                  | the desktop app            |
| `@modelcontextprotocol/sdk` | the MCP server             |

That is what makes this package reusable. Shared code reaching for any one of them
breaks the other hosts **at runtime, not at compile time** -- and possibly only on a
path nobody exercises during review.

The rule was originally written as "nothing may import `vscode`", which was too
narrow and had a real hole: an Electron import in a module that no test happened to
cover passed every check -- eslint, `typecheck:hosts`, both host bundles, and the
entire test suite. It was found by injecting the fault, not by reading the code.

So the rule is enforced mechanically, and against all three:

- `src/hostAgnostic.test.ts` enumerates every non-test file in `src/` and asserts
  none imports any host module. It also asserts the enumeration is non-empty and
  contains known members, so it cannot pass by finding nothing.
- `src/hostModuleScan.ts` holds the detector -- one copy, shared with every host's
  guard, because it was previously duplicated with no self-tests on one side.
  `hostModuleScan.test.ts` covers every module in every import form: static, bare
  side-effect, `require`, dynamic `import`, and **subpaths**. Subpaths are not
  defensive: the MCP SDK is only ever imported that way, so an exact-specifier match
  would have missed every real usage while looking correct.
- A test asserts the module list still has all three, so a fourth host cannot be
  added without noticing.

Each host runs the mirror image of this guard -- "my own host API and no other" --
so the extension host is stopped from importing `electron`, and so on.

If you need a host API, your code belongs in that host's package. `HostPort` is the
seam: define what you need in terms of that interface and let each host implement it.

## What lives here

| Area             | Modules                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Data access      | `athena`, `dynamodb`, `aurora`, `redshift`, `opensearch`, `logsInsights`, `sqs`             |
| Schema knowledge | `schema` (per-destination record shapes and query idioms)                                   |
| Query safety     | `queryValidator` (`assertReadOnly`), `queryShape`, `verdict`, `sandbox`                     |
| Diagnostics      | `destinationTest`                                                                           |
| Session behavior | `explorerSession` (host-free, driven through `HostPort`)                                    |
| LLM providers    | `llm`, `agentLoop`, `bedrockConverse`, `bedrockModels`, `localServerParse`, `copilotBridge` |
| Config and seam  | `configCore`, `hostPort`, `hostCapabilities`, `settingsKeys`                                |

## Consumed as TypeScript source, on purpose

This package is `private: true` and its `main`/`types` point at `src/index.ts`
rather than a build output, so it has **no build step**.

Both consumers already bundle with esbuild, so they compile these sources
directly. Publishing the package instead would turn an internal boundary into a
public API surface with semver obligations, for no benefit to anyone outside this
repository. If a published package ever needs to depend on it, bundle it in rather
than adding it to the dependency tree.

`src/index.ts` is a barrel re-exporting every module. That is safe here because no
two modules export the same name — zero collisions across every exported
declaration, checked rather than assumed. A collision would silently shadow one
module's export.

The package is **scoped but still private**. Scoping removes the question an
unscoped, unclaimed name invites: nothing else can ever publish under `@aws/`, so
there is no name for a third party to take even though workspace resolution always
wins in-repo. Consumers pin the exact version rather than using `*`.

## Working on it

```bash
npm test      -w packages/durable-insight-core   # jest
npm run typecheck -w packages/durable-insight-core
```

`npm run typecheck:hosts` from the repository root checks this package and both
hosts together, which is what CI runs.

Note that `tsconfig.json` excludes `*.test.ts`, so `typecheck` does not cover test
files — `ts-jest` compiles those when the suite runs. It also sets `noEmit`, because
this package has no build step; running `tsc` here should not leave a `dist/`.

The root `eslint.config.js` additionally restricts these packages from importing
`vscode` (in core) or reaching a sibling package by relative path (in all three).
Those rules are the earliest signal, not the enforcement: eslint currently runs only
via lint-staged on pre-commit, and there is no lint job in CI, so the tests above are
what actually gate a pull request.
