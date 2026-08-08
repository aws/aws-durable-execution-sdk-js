# durable-insight-core

The host-free core of Workflow Insight: everything that queries a destination,
understands the record schema, and keeps queries safe — with no dependency on any
particular UI or runtime.

It exists so the hosts can share one implementation instead of copying it.

```
                 ┌──────────────────────────────────┐
                 │       durable-insight-core       │
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

**Nothing in this package may import `vscode`.**

That is what makes it reusable: the Electron app has no VS Code API, so a single
`import * as vscode from "vscode"` anywhere in here would break it — at runtime,
not at compile time, and possibly only on a code path nobody exercises during
review.

So the rule is enforced mechanically rather than by convention.
`src/hostAgnostic.test.ts` enumerates every non-test file in `src/` and asserts
none of them imports `vscode`, in either the namespace/named form or a bare
side-effect `import "vscode"`. It also asserts the enumeration is non-empty and
contains known members, so it cannot pass by finding nothing, and it includes
"guards the guard" cases that write a temporary offending fixture and confirm the
detector catches it.

If you need the VS Code API, your code belongs in
`aws-durable-execution-sdk-js-insight-vscode`, not here. `HostPort` is the seam:
define what you need in terms of that interface and let each host implement it.

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
two modules export the same name — 103 exported declarations across the 25 modules,
of which 66 are runtime values and the rest type-only, with zero collisions. A
collision would silently shadow one module's export, so it is worth knowing that
the barrel was checked rather than assumed.

## Working on it

```bash
npm test      -w packages/durable-insight-core   # jest
npm run typecheck -w packages/durable-insight-core
```

`npm run typecheck:hosts` from the repository root checks this package and both
hosts together, which is what CI runs.

Note that `tsconfig.json` excludes `*.test.ts`, so `typecheck` does not cover test
files — `ts-jest` compiles those when the suite runs.
