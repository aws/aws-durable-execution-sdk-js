# Releasing

This document describes how to cut releases in this monorepo.

Most packages use the automated npm publishing workflow. The Durable Execution Telemetry VSCode extension is an exception: it is released as `.vsix` assets attached to GitHub Releases and does **not** follow the npm package release guidance.

## Packages

The automated npm publishing workflow covers the following packages:

| Package                                        | Path                                                  | Tag Prefix |
| ---------------------------------------------- | ----------------------------------------------------- | ---------- |
| `@aws/durable-execution-sdk-js`                | `packages/aws-durable-execution-sdk-js`               | `sdk`      |
| `@aws/durable-execution-sdk-js-testing`        | `packages/aws-durable-execution-sdk-js-testing`       | `test`     |
| `@aws/durable-execution-sdk-js-eslint-plugin`. | `packages/aws-durable-execution-sdk-js-eslint-plugin` | `eslint`   |
| `@aws/durable-execution-sdk-js-otel`           | `packages/aws-durable-execution-sdk-js-otel`          | `otel`     |
| `@aws/durable-execution-sdk-js-telemetry-exporter`        | `packages/aws-durable-execution-sdk-js-telemetry-exporter`       | `telemetry-exporter` |
| `@aws/durable-execution-sdk-js-telemetry-mcp`    | `packages/aws-durable-execution-sdk-js-telemetry-mcp`   | `telemetry-mcp` |

Extras and MicroVM Worker are excluded from automatic publishing while their first npm publication is prepared separately. Both initial publication attempts in `sdk-2.7.0` failed. Before adding them to the automatic package list, prepare their first release and npm publisher setup, and remove their explicit deferral from the packaging test.

The `packages/aws-durable-execution-sdk-js-telemetry-vscode` package is intentionally excluded from this table. Release it with the [Durable Execution Telemetry VSCode Extension](#durable-execution-telemetry-vscode-extension-publishing) process instead.

## Versioning

Each package maintains its own version in the `version` field of its `package.json`:

- SDK: `packages/aws-durable-execution-sdk-js/package.json`
- Testing: `packages/aws-durable-execution-sdk-js-testing/package.json`
- ESLint plugin: `packages/aws-durable-execution-sdk-js-eslint-plugin/package.json`
- OTel: `packages/aws-durable-execution-sdk-js-otel/package.json`
- Telemetry Exporter: `packages/aws-durable-execution-sdk-js-telemetry-exporter/package.json`
- Telemetry MCP: `packages/aws-durable-execution-sdk-js-telemetry-mcp/package.json`

Bump the version in the appropriate `package.json` file(s) and merge to `main` before creating a release.

### Released minor versions and the next major release

The published `sdk-2.7.0` release contains core **2.7.0**, OTel **1.2.0**, and
testing **1.3.1**. The `sdk-2.7.1` patch releases core **2.7.1** and OTel
**1.2.1** with the operation telemetry corrections from #960. The major factory
migration retains those fixes and the current conformance handlers.

Those released core/OTel pairs include registration exclusivity from #956,
but do not include invocation-local LMI carrier forwarding or extraction from
#955. That carrier capability is planned for core **3.0.0** / OTel **2.0.0** in
#924, together with per-invocation plugin factories. Until that release, it is
available only in matched development builds containing the change; existing
package version labels do not identify those builds.

The released OTel 1.2 packages preserve their optional `>=2.4.0 <3.0.0` core
peer, provider API version 1, and separate OTel-only layers. Core 3 uses the new
factory contract and requires matching plugin packages/layers. Installed-package
tests retain released-version controls and verify both the declared major-pair
compatibility and explicit rejection of legacy providers. Version edits do not
publish packages.

## Cutting a Release

### 1. Bump the version

Update the `version` string in the relevant `package.json` file(s). Commit and merge to `main`.

### 2. Create a GitHub Release

1. Go to the [Releases page](https://github.com/aws/aws-durable-execution-sdk-js/releases) on GitHub.
2. Click **Draft a new release**.
3. Create a new tag following the [tagging convention](#tagging-convention) below.
4. Set the release title (typically the same as the tag).
5. Write release notes following the [Release Notes Format](#release-notes-format).
6. Click **Publish release**.

### Tagging Convention

The tag should be the version of the package(s) being bumped, prepended with a descriptive prefix, joined with `/` when more than one package is released together:

- SDK only: `sdk-<version>` (e.g., `sdk-2.2.0`)
- Testing only: `test-<version>` (e.g., `test-1.1.3`)
- ESLint plugin only: `eslint-<version>` (e.g., `eslint-1.0.0`)
- OTel only: `otel-<version>` (e.g., `otel-0.1.1`)
- Telemetry Exporter only: `telemetry-exporter-<version>` (e.g., `telemetry-exporter-0.1.0`)
- Telemetry MCP only: `telemetry-mcp-<version>` (e.g., `telemetry-mcp-0.1.0`)
- Multiple packages in a single release: join the sub-tags with `/` (e.g., `sdk-2.1.0/test-1.1.3/otel-0.1.1`)

Examples:

```
sdk-2.2.0
otel-0.1.1
test-1.1.3
sdk-2.1.0/test-1.1.3/otel-0.1.1
sdk-2.2.0/telemetry-exporter-0.1.0
telemetry-mcp-0.1.0
```

If additional packages are added to the monorepo in the future, follow the same pattern: choose a short descriptive prefix for the package and use `<prefix>-<version>`.

> **Note:** Automated rollout of new versions into the SDK bundled with the Lambda managed runtime relies on the release tag matching the `sdk-<version>` format. For any SDK version we want in the runtime, ensure there is a release with a tag in the exact `sdk-<version>` format (if needed, create a new release for the same commit with a correctly formatted tag).

## How Publishing Works

Creating a GitHub Release triggers the [`npm-publish.yml`](.github/workflows/npm-publish.yml) workflow automatically. The workflow:

1. Checks out the released tag.
2. Installs dependencies, builds all packages, and runs the test suite.
3. Publishes each package to [npm](https://www.npmjs.com/package/@aws/durable-execution-sdk-js) using OIDC-based trusted publishing (no API tokens required).

The workflow runs on the `release: [published]` event, so it fires whenever a release is published on GitHub — no manual intervention is needed beyond creating the release.

> **Note:** The workflow builds and publishes all packages. Ensure the version in each package's `package.json` is correct before publishing. If only one package has a version bump, the unchanged packages are skipped (which is expected and harmless).

## Durable Execution Telemetry VSCode Extension Publishing

The Durable Execution Telemetry VSCode extension at [`packages/aws-durable-execution-sdk-js-telemetry-vscode`](packages/aws-durable-execution-sdk-js-telemetry-vscode) has a separate release process.

> **Warning:** Running the extension workflow publishes a GitHub Release as its final step, which emits the repo-wide `release.published` event and can start automation such as the npm publish workflow. When that happens, the npm workflow checks its hardcoded package list and may publish any listed npm package whose version has not already been published. The npm workflow does not include or publish this private VS Code extension package.

The VS Code extension is distributed as `.vsix` files attached to GitHub Releases for testers and customers. It is not published to npm or the VS Code Marketplace.

Do not use the normal GitHub **publishing** flow for this extension. The JS SDK repo has immutable releases enabled, so assets must be attached while the release is still a draft. The manual [vscode extension release](https://github.com/aws/aws-durable-execution-sdk-js/actions/workflows/vscode-extension-release.yml) workflow creates or reuses a draft release, uploads all required `.vsix` files, verifies them, and only then publishes the release.

### 1. Update the Extension Version

Update [`packages/aws-durable-execution-sdk-js-telemetry-vscode/package.json`](packages/aws-durable-execution-sdk-js-telemetry-vscode/package.json). The workflow input must exactly match this `version` value on the ref you run.

Review, approve, and merge the version update PR before running the release workflow. The PR is the release approval.

### 2. Run the GitHub Action

1. Open [Actions](https://github.com/aws/aws-durable-execution-sdk-js/actions), select **vscode extension release**, and choose **Run workflow**.
2. Select the default branch after the version update PR is merged.
3. Enter the exact extension version from `packages/aws-durable-execution-sdk-js-telemetry-vscode/package.json`.
4. Start the workflow.

The workflow creates the release tag `telemetry-vscode-v<version>` and the release title `Durable Execution Telemetry VSCode <version> (Preview)`.

### 3. Verify the Release Assets

The workflow builds and uploads one `.vsix` per supported platform:

| Platform            | Expected asset                                                            |
| ------------------- | ------------------------------------------------------------------------- |
| Apple Silicon macOS | `aws-durable-execution-sdk-js-telemetry-vscode-<version>-darwin-arm64.vsix` |
| Windows x64         | `aws-durable-execution-sdk-js-telemetry-vscode-<version>-win32-x64.vsix`    |
| Windows ARM64       | `aws-durable-execution-sdk-js-telemetry-vscode-<version>-win32-arm64.vsix`  |
| Linux x64           | `aws-durable-execution-sdk-js-telemetry-vscode-<version>-linux-x64.vsix`    |

After the workflow succeeds, install the newly built extension following the [install preview build](packages/aws-durable-execution-sdk-js-telemetry-vscode/README.md#install-preview-build) instructions.

### 4. Recovery

If the workflow fails before publication, the release is left as a draft. Fix the failed matrix leg and re-run **vscode extension release** with the same version. The workflow reuses the existing draft release for `telemetry-vscode-v<version>` and uploads rebuilt `.vsix` assets with `--clobber`, so corrected assets replace earlier draft assets.

If verification finds that any expected `.vsix` asset is missing, the workflow exits without publishing and leaves the draft release in place. Re-run the workflow with the same version after fixing the issue.

If the release was already published with bad assets, do not try to replace assets on that release. Published releases are immutable, and the workflow refuses to modify a non-draft release. Bump the extension version, merge the version update PR, and run **vscode extension release** again to publish a corrected release.

## Release Notes Format

Release notes should maintain separate timelines for each package. Use the following structure:

```markdown
# @aws/durable-execution-sdk-js

## What's Changed

- feat(sdk): added support for X by @<author> in #<pr>
- fix(sdk): fixed issue with Y under Z conditions by @<author> in #<pr>

### Breaking Changes

- feat(sdk): removed deprecated `bar()` method by @<author> in #<pr>

**Full Changelog**: [<previous-sdk-tag>...<this-tag>](changelog-url)

# @aws/durable-execution-sdk-js-otel

## What's Changed

- feat(otel): added tracing for `map` operations by @<author> in #<pr>
- fix(otel): fixed span context propagation in child contexts by @<author> in #<pr>

**Full Changelog**: [<previous-otel-tag>...<this-tag>](changelog-url)

# @aws/durable-execution-sdk-js-testing

## What's Changed

- fix(test): fixed issue with test runner under condition Z by @<author> in #<pr>

**Full Changelog**: [<previous-test-tag>...<this-tag>](changelog-url)
```

If only one package is being released, include only that package's section. Each package's changelog should be self-contained so users can follow the history of the package they depend on independently.

## Checklist

Before publishing a release:

- [ ] Version bumped in the relevant `package.json` file(s)
- [ ] Changes merged to `main`
- [ ] CI checks pass on `main`
- [ ] Release notes written with separate sections per package
- [ ] Tag follows the naming convention (`sdk-X.Y.Z`, `otel-X.Y.Z`, `test-X.Y.Z`, `eslint-X.Y.Z`, `telemetry-exporter-X.Y.Z`, `telemetry-mcp-X.Y.Z`, or `/`-joined)

## SDK 3.x migration release order

The published minor releases use testing SDK 1.3.1 with core 2.x. This major
migration uses testing SDK 1.3.2 with its broadened `>=1.0.1 <4.0.0` peer range,
so publication cannot skip the new range because 1.3.1 already exists. Core
3.0.0 and OTel 2.0.0 carry the explicit factory migration; testing remains a
compatible patch. The renamed Telemetry Exporter retains the upstream
0.1.0-alpha.0 version and requires core `>=3.0.0 <4.0.0` for its factory API.
Version metadata does not authorize a merge or publication.
