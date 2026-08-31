# Releasing

This document describes how to cut releases in this monorepo.

Most packages use the automated npm publishing workflow. The Workflow Insight Explorer VS Code extension is an exception: it is released as `.vsix` assets attached to GitHub Releases and does **not** follow the npm package release guidance.

## Packages

The automated npm publishing workflow covers the following packages:

| Package                                        | Path                                                  | Tag Prefix |
| ---------------------------------------------- | ----------------------------------------------------- | ---------- |
| `@aws/durable-execution-sdk-js`                | `packages/aws-durable-execution-sdk-js`               | `sdk`      |
| `@aws/durable-execution-sdk-js-testing`        | `packages/aws-durable-execution-sdk-js-testing`       | `test`     |
| `@aws/durable-execution-sdk-js-eslint-plugin`. | `packages/aws-durable-execution-sdk-js-eslint-plugin` | `eslint`   |
| `@aws/durable-execution-sdk-js-otel`           | `packages/aws-durable-execution-sdk-js-otel`          | `otel`     |
| `@aws/durable-execution-sdk-js-insight`        | `packages/aws-durable-execution-sdk-js-insight`       | `insight`  |
| `@aws/durable-execution-sdk-js-insight-mcp`    | `packages/aws-durable-execution-sdk-js-insight-mcp`   | `mcp`      |

The `packages/aws-durable-execution-sdk-js-insight-vscode` package is intentionally excluded from this table. Release it with the [Workflow Insight Explorer VS Code Extension](#workflow-insight-explorer-vs-code-extension-publishing) process instead.

### Legal files

Every package in the table above ships a copy of the repo root `LICENSE` and `NOTICE`, listed in its `files` array so npm packs them. Declaring `"license"` in `package.json` is not sufficient on its own: that field is only a metadata pointer, and npm does not pack `NOTICE` implicitly.

`npm run check:legal-files` enforces this, and runs in CI on every PR and again before publishing. When adding a package to the release list, copy both files into the package directory and add them to `files`, or the check will fail.

## Versioning

Each package maintains its own version in the `version` field of its `package.json`:

- SDK: `packages/aws-durable-execution-sdk-js/package.json`
- Testing: `packages/aws-durable-execution-sdk-js-testing/package.json`
- ESLint plugin: `packages/aws-durable-execution-sdk-js-eslint-plugin/package.json`
- OTel: `packages/aws-durable-execution-sdk-js-otel/package.json`
- Insight: `packages/aws-durable-execution-sdk-js-insight/package.json`
- Insight MCP: `packages/aws-durable-execution-sdk-js-insight-mcp/package.json`

Bump the version in the appropriate `package.json` file(s) and merge to `main` before creating a release.

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
- Insight only: `insight-<version>` (e.g., `insight-0.1.0`)
- Insight MCP only: `mcp-<version>` (e.g., `mcp-0.1.0`)
- Multiple packages in a single release: join the sub-tags with `/` (e.g., `sdk-2.1.0/test-1.1.3/otel-0.1.1`)

Examples:

```
sdk-2.2.0
otel-0.1.1
test-1.1.3
sdk-2.1.0/test-1.1.3/otel-0.1.1
sdk-2.2.0/insight-0.1.0
mcp-0.1.0
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

## Workflow Insight Explorer VS Code Extension Publishing

The Workflow Insight Explorer VS Code extension at [`packages/aws-durable-execution-sdk-js-insight-vscode`](packages/aws-durable-execution-sdk-js-insight-vscode) has a separate release process.

> **Warning:** Running the extension workflow publishes a GitHub Release as its final step, which emits the repo-wide `release.published` event and can start automation such as the npm publish workflow. When that happens, the npm workflow checks its hardcoded package list and may publish any listed npm package whose version has not already been published. The npm workflow does not include or publish this private VS Code extension package.

The VS Code extension is distributed as `.vsix` files attached to GitHub Releases for testers and customers. It is not published to npm or the VS Code Marketplace.

Do not use the normal GitHub **publishing** flow for this extension. The JS SDK repo has immutable releases enabled, so assets must be attached while the release is still a draft. The manual [vscode extension release](https://github.com/aws/aws-durable-execution-sdk-js/actions/workflows/vscode-extension-release.yml) workflow creates or reuses a draft release, uploads all required `.vsix` files, verifies them, and only then publishes the release.

### 1. Update the Extension Version

Update [`packages/aws-durable-execution-sdk-js-insight-vscode/package.json`](packages/aws-durable-execution-sdk-js-insight-vscode/package.json). The workflow input must exactly match this `version` value on the ref you run.

Review, approve, and merge the version update PR before running the release workflow. The PR is the release approval.

### 2. Run the GitHub Action

1. Open [Actions](https://github.com/aws/aws-durable-execution-sdk-js/actions), select **vscode extension release**, and choose **Run workflow**.
2. Select the default branch after the version update PR is merged.
3. Enter the exact extension version from `packages/aws-durable-execution-sdk-js-insight-vscode/package.json`.
4. Start the workflow.

The workflow creates the release tag `workflow-insight-vscode-v<version>` and the release title `Workflow Insight Explorer <version> (Preview)`.

### 3. Verify the Release Assets

The workflow builds and uploads one `.vsix` per supported platform:

| Platform            | Expected asset                                                            |
| ------------------- | ------------------------------------------------------------------------- |
| Apple Silicon macOS | `aws-durable-execution-sdk-js-insight-vscode-<version>-darwin-arm64.vsix` |
| Windows x64         | `aws-durable-execution-sdk-js-insight-vscode-<version>-win32-x64.vsix`    |
| Windows ARM64       | `aws-durable-execution-sdk-js-insight-vscode-<version>-win32-arm64.vsix`  |
| Linux x64           | `aws-durable-execution-sdk-js-insight-vscode-<version>-linux-x64.vsix`    |

After the workflow succeeds, install the newly built extension following the [install preview build](packages/aws-durable-execution-sdk-js-insight-vscode/README.md#install-preview-build) instructions.

### 4. Recovery

If the workflow fails before publication, the release is left as a draft. Fix the failed matrix leg and re-run **vscode extension release** with the same version. The workflow reuses the existing draft release for `workflow-insight-vscode-v<version>` and uploads rebuilt `.vsix` assets with `--clobber`, so corrected assets replace earlier draft assets.

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
- [ ] Tag follows the naming convention (`sdk-X.Y.Z`, `otel-X.Y.Z`, `test-X.Y.Z`, `eslint-X.Y.Z`, `insight-X.Y.Z`, `mcp-X.Y.Z`, or `/`-joined)
