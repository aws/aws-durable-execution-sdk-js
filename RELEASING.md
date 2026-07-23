# Releasing

This document describes how to cut a release for packages in this monorepo and how the automated npm publishing workflow is triggered.

## Packages

This monorepo contains the following packages:

| Package                                       | Path                                                  | Tag Prefix |
| --------------------------------------------- | ----------------------------------------------------- | ---------- |
| `@aws/durable-execution-sdk-js`               | `packages/aws-durable-execution-sdk-js`               | `sdk`      |
| `@aws/durable-execution-sdk-js-testing`       | `packages/aws-durable-execution-sdk-js-testing`       | `test`     |
| `@aws/durable-execution-sdk-js-eslint-plugin` | `packages/aws-durable-execution-sdk-js-eslint-plugin` | `eslint`   |
| `@aws/durable-execution-sdk-js-otel`          | `packages/aws-durable-execution-sdk-js-otel`          | `otel`     |
| `@aws/durable-execution-sdk-js-insight`       | `packages/aws-durable-execution-sdk-js-insight`       | `insight`  |

## Versioning

Each package maintains its own version in the `version` field of its `package.json`:

- SDK: `packages/aws-durable-execution-sdk-js/package.json`
- Testing: `packages/aws-durable-execution-sdk-js-testing/package.json`
- ESLint plugin: `packages/aws-durable-execution-sdk-js-eslint-plugin/package.json`
- OTel: `packages/aws-durable-execution-sdk-js-otel/package.json`
- Insight: `packages/aws-durable-execution-sdk-js-insight/package.json`

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
- Multiple packages in a single release: join the sub-tags with `/` (e.g., `sdk-2.1.0/test-1.1.3/otel-0.1.1`)

Examples:

```
sdk-2.2.0
otel-0.1.1
test-1.1.3
sdk-2.1.0/test-1.1.3/otel-0.1.1
sdk-2.2.0/insight-0.1.0
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
- [ ] Tag follows the naming convention (`sdk-X.Y.Z`, `otel-X.Y.Z`, `test-X.Y.Z`, `eslint-X.Y.Z`, `insight-X.Y.Z`, or `/`-joined)
