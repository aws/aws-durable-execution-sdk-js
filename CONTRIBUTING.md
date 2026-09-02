# Contributing Guidelines

Thank you for your interest in contributing to our project. Whether it's a bug report, new feature, correction, or additional
documentation, we greatly value feedback and contributions from our community.

Please read through this document before submitting any issues or pull requests to ensure we have all the necessary
information to effectively respond to your bug report or contribution.

## Reporting Bugs/Feature Requests

We welcome you to use the GitHub issue tracker to report bugs or suggest features.

When filing an issue, please check existing open, or recently closed, issues to make sure somebody else hasn't already
reported the issue. Please try to include as much information as you can. Details like these are incredibly useful:

- A reproducible test case or series of steps
- The version of our code being used
- Any modifications you've made relevant to the bug
- Anything unusual about your environment or deployment

## Contributing via Pull Requests

Contributions via pull requests are much appreciated. Before sending us a pull request, please ensure that:

1. You are working against the latest source on the _main_ branch.
2. You check existing open, and recently merged, pull requests to make sure someone else hasn't addressed the problem already.
3. You open an issue to discuss any significant work - we would hate for your time to be wasted.

To send us a pull request, please:

1. Fork the repository.
2. Modify the source; please focus on the specific change you are contributing. If you also reformat all the code, it will be hard for us to focus on your change.
3. Write tests for your changes and ensure all tests pass. At minimum, include related **unit tests**. Add **composed tests** when the change spans multiple internal components, and **integration tests** when it affects public API surfaces or end-to-end workflows. For isolated bug fixes where a unit test alone sufficiently covers the fix, composed or integration tests are not required. See [TESTING.md](TESTING.md) for details on running tests, understanding the testing architecture, and the naming conventions (unit, composed, integration).
4. Do **not** add conformance tests. If you believe your change warrants a conformance test, please mention it in your PR description or open an issue in the [Conformance Tests repository](https://github.com/aws/aws-durable-execution-conformance-tests/issues/new?template=new_requirement.yml).
5. If your contribution includes new SDK features, API changes, or testing library enhancements, please also add or update examples in the [examples package](./packages/aws-durable-execution-sdk-js-examples) to demonstrate and validate these changes. Examples serve as both documentation and integration tests. See [ADDING_EXAMPLES.md](./packages/aws-durable-execution-sdk-js-examples/ADDING_EXAMPLES.md) for implementation details.
6. Commit to your fork using clear conventional commit messages.
7. Send us a pull request with the title matching conventional commits, answering any default questions in the pull request interface. If the PR type has a scope, it must match `sdk`, `sdk-testing`, `examples`, `eslint-plugin`, or `ci`. For example: `feat(sdk): add map handler functionality` or `fix(sdk-testing): fix race condition in checkpoint server`.
8. Pay attention to any automated CI failures reported in the pull request, and stay involved in the conversation.

### Formatting and linting

Formatting and linting are enforced in CI, so run them before pushing:

```bash
npm run lint:fix      # Biome: formats and lints JS/TS/JSON, applying safe fixes
npm run format:docs   # Prettier: formats Markdown and YAML, which Biome does not handle
```

`npm run lint` checks without writing. A pre-commit hook runs both over staged
files, so in normal use this happens automatically — but `--no-verify` skips it,
and CI does not.

If you have a branch that predates the move to Biome, expect formatting
differences on first push: Biome's output is not byte-identical to Prettier's.
`npm run lint:fix` resolves them in one pass.

GitHub provides additional document on [forking a repository](https://help.github.com/articles/fork-a-repo/) and
[creating a pull request](https://help.github.com/articles/creating-a-pull-request/).

## Finding contributions to work on

Looking at the existing issues is a great way to find something to contribute on. As our projects, by default, use the default GitHub issue labels (enhancement/bug/duplicate/help wanted/invalid/question/wontfix), looking at any 'help wanted' issues is a great place to start.

## Code of Conduct

This project has adopted the [Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct).
For more information see the [Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq) or contact
opensource-codeofconduct@amazon.com with any additional questions or comments.

## Security issue notifications

If you discover a potential security issue in this project we ask that you notify AWS/Amazon Security via our [vulnerability reporting page](http://aws.amazon.com/security/vulnerability-reporting/). Please do **not** create a public github issue.

## Licensing

See the [LICENSE](LICENSE) file for our project's licensing. We will ask you to confirm the licensing of your contribution.
