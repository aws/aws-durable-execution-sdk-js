# Releasing Workflow Insight Explorer VS Code Extension

This document describes how to publish Workflow Insight Explorer VS Code extension assets for testers and customers.

> **Warning:** Running this workflow publishes a GitHub Release as its final step. That emits the repo-wide `release.published` event and can start automation such as the npm publish workflow. When it runs, the npm workflow checks its hardcoded list, and any listed package whose version has not already been published may be published to npm. It does not include or publish this private VS Code extension package.

## Publishing Workflow Insight VS Code Extension Assets

The [Workflow Insight Explorer VS Code extension](https://github.com/aws/aws-durable-execution-sdk-js/tree/main/packages/aws-durable-execution-sdk-js-insight-vscode) is distributed as `.vsix` files attached to GitHub Releases. Use this process when you need to publish new Workflow Insight Explorer extension assets for testers or customers.

This workflow only publishes `.vsix` assets to a GitHub Release. It does not publish the extension to npm or the VS Code Marketplace.

Do not use the normal GitHub **publishing** flow for this extension. The JS SDK repo has immutable releases enabled, so assets must be attached while the release is still a draft. The manual [vscode extension release](https://github.com/aws/aws-durable-execution-sdk-js/actions/workflows/vscode-extension-release.yml) workflow creates or reuses a draft release, uploads all required `.vsix` files, verifies them, and only then publishes the release.

### 1. Update the Extension Version

Update [packages/aws-durable-execution-sdk-js-insight-vscode/package.json](https://github.com/aws/aws-durable-execution-sdk-js/blob/main/packages/aws-durable-execution-sdk-js-insight-vscode/package.json). The workflow input must exactly match this `version` value on the ref you run.

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

After the workflow succeeds, install the newly built extension following the [install preview build](https://github.com/aws/aws-durable-execution-sdk-js/blob/main/packages/aws-durable-execution-sdk-js-insight-vscode/README.md#install-preview-build) instructions.

### 4. Recovery

If the workflow fails before publication, the release is left as a draft. Fix the failed matrix leg and re-run **vscode extension release** with the same version. The workflow reuses the existing draft release for `workflow-insight-vscode-v<version>` and uploads rebuilt `.vsix` assets with `--clobber`, so corrected assets replace earlier draft assets.

If verification finds that any expected `.vsix` asset is missing, the workflow exits without publishing and leaves the draft release in place. Re-run the workflow with the same version after fixing the issue.

If the release was already published with bad assets, do not try to replace assets on that release. Published releases are immutable, and the workflow refuses to modify a non-draft release. Bump the extension version, merge the version update PR, and run **vscode extension release** again to publish a corrected release.
