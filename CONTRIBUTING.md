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

### Rules for every change

These rules apply to every package in this repository, to people and to coding agents. A
package can add its own rules in its `AGENTS.md` or README. Many pull requests are now
written with AI help, and AI-written changes tend to add logic. These rules keep each
change as small as the problem.

#### 1. Keep it simple

1. Do not add a mechanism only to make a rare case faster. Correctness is required. Speed
   in a rare case is not.
2. Do not add configuration that nobody asked for.
3. For a new feature, prefer the simpler option, even if it loses a minor capability of a
   more complex option. An existing feature has users, so removing a capability of it is
   a breaking change and follows the release rules instead.

#### 2. Simplify before you add

1. Every new condition, branch or option adds cases that readers and tests must cover.
2. A bug or a missing use case often exists because the existing logic is more complex
   than the problem. A special case hides another case, or two paths do the same job in
   different ways.
3. So the first question for a bug fix or a feature is: can a simpler version of the
   existing logic cover it?
4. A change that fixes the bug or covers the use case and removes or merges logic is
   preferred to a change that adds logic. This holds even when the simpler change
   touches more lines.
5. If a change must add logic, its description states which simpler options were
   considered and why each one does not work.

#### 3. Write a design note before the code

1. A review finds a wrong approach only after the code exists. Rewriting code costs more
   than rewriting a note.
2. So a new feature, a new option or a change to a public API starts with a design note.
   A bug fix that changes a public API needs one too.
3. The note states, in this order:
   1. the problem, in one or two sentences, without a solution;
   2. the cause;
   3. the options considered, including a simplification of existing logic (rule 2);
   4. the chosen option and the reason;
   5. what the change removes, if anything.
4. A maintainer agrees to the note before the code is written. The note goes in the
   issue or in the pull request description. A change to an SDK invariant needs an ADR in
   [docs/adr](./docs/adr) instead.

#### 4. Every branch has a test that fails without it

1. Line coverage does not prove that a branch matters. A test can run a branch whose
   result changes no assertion.
2. So for each condition and each branch in a change, some test must fail when the branch
   is removed or inverted.
3. The reviewer asks of each condition: which test fails if this is deleted? A branch
   without an answer is removed, or it gets a test.
4. Defensive code for a case that cannot happen has no such test. So it is removed.

#### 5. A bug fix starts with a failing test

1. A test that reproduces the bug proves that the bug exists. The same test proves that
   the fix removes it.
2. So a bug fix first adds a test that fails on the current code. The fix then makes it
   pass. The pull request description shows the test failing before the fix, or the
   commit order shows it.
3. The description names the root cause, not only the symptom. The fix changes the code
   at the cause. Example: a value arrives in an unexpected unit. The fix converts it once,
   where it enters the code. It does not change every place that reads it.
4. A change that edits the expectation of an existing test lists the edited test and the
   reason in its description. A contract test is never edited to make a change pass (see
   [SDK invariants](#sdk-invariants)).

#### 6. Mark unverified assumptions

1. A change often depends on behavior outside the package: the service, Lambda, the
   language runtime or another library.
2. An assumption about that behavior can be wrong, and the tests then pass anyway,
   because a fake of the outside component encodes the same assumption.
3. So every assumption that a change depends on cites its evidence: a run against the
   real component, a document or a test against the real component.
4. An assumption without evidence is marked "unverified" in the pull request description.
   The reviewer decides whether a check against the real component is needed before
   approval.

#### 7. List the decisions that the task did not cover

1. An issue or a design note never covers every detail. So the contributor makes some
   decisions alone.
2. A decision that is hidden in the code cannot be reviewed.
3. So the pull request description lists every decision that the issue or the design
   note did not cover, one line each, with the reason. Examples: a default value, an
   error message, a changed edge case, a skipped test.
4. A maintainer accepts or rejects each listed decision.

#### 8. Repeated review findings mean a redesign

A review finding is a change request or a blocking issue from a reviewer, a person or an
agent. A round is one review of a revision, followed by the contributor's changes.

1. A correct and simple change usually passes review after one round of fixes.
2. Sometimes a reviewer finds new problems in the code that fixed the previous findings.
   Each fix then adds a case, a condition or a special path.
3. This pattern has a few common causes:
   - the feature itself is wrong;
   - the implementation is wrong or too complex;
   - the change fixes a symptom instead of the cause.
4. More fixes on the same design add complexity and break rule 1.
5. So the trigger is this: the contributor addressed every finding of a round, and the
   next review finds new blocking issues. At the trigger, the contributor stops fixing.
6. The contributor then returns to the design phase:
   1. State the problem again in one or two sentences, without the current solution.
   2. Find the cause. Ask why the problem happens until the answer is a fact about the
      system, not about the code that the change added.
   3. List the review findings of all rounds. Check whether one cause explains several of
      them.
   4. Consider simpler options, including not adding the feature.
   5. Write the chosen design and the reason in the pull request, and get the reviewer's
      agreement before writing new code.
7. The new design may keep parts of the old code. It may also replace the change
   completely. A smaller change that solves the cause is better than a larger change
   that passes review.
8. A coding agent that hits the trigger stops. It reports the findings of all rounds and
   its analysis of the cause, and it waits for a decision before it continues.

#### 9. Reviewers enforce these rules

1. A reviewer, a person or an agent, checks every change against these rules and the
   package's own rules, not only for correctness.
2. A change can be correct and still break a rule. Examples: it adds logic where a
   simplification works (rule 2), it has no design note (rule 3), or it has a branch that
   no test needs (rule 4).
3. Change requests on such a change produce a better version of the wrong approach. So
   for a change that breaks a rule, the reviewer does not ask for detailed code changes.
4. Instead, the reviewer pushes back on the approach. The review names the rule, states
   how the change breaks it, and asks the contributor to return to the design phase
   (rule 8, step 6). The reviewer can suggest a simpler direction.
5. The reviewer approves only a change that follows every rule. A reviewer who wants an
   exception names the rule and the reason in the review, and a maintainer decides.

#### 10. Other SDKs inform a change; they do not justify it

1. The Durable Execution SDKs in other languages follow the same specification and pass
   the same [conformance tests](https://github.com/aws/aws-durable-execution-conformance-tests).
2. A new conformance test or a change in another SDK says what this repository must
   support. The rules of this repository say how it is built. So a change here follows
   these rules, whatever another SDK did. "Another SDK does it this way" is not a reason
   in a design note. The reason is the problem in this repository.
3. If a conformance test requires behavior that breaks a rule of this repository, the
   contributor raises the conflict with the maintainers. The contributor does not skip
   the test and does not break the rule.

#### 11. Same behavior, native syntax

1. All SDKs provide the same capabilities. Executions and tools cross language
   boundaries. So these must be the same in every language:
   - the wire format: operation ids, checkpoint updates, payloads and errors;
   - the replay and checkpoint semantics that the conformance tests check;
   - the names of the concepts: step, wait, map, parallel, callback, invoke.
2. The API surface can differ: syntax, signatures, overloads, option objects and the
   async model. A pattern that is native to Java, .NET or Python does not apply to this
   SDK only because another SDK uses it.
3. A capability that another SDK has and this SDK leaves out needs a reason in the
   design note (rule 3).

### SDK invariants

The SDK keeps rules about when an invocation may suspend and how plugin hooks run. Read
[packages/aws-durable-execution-sdk-js/AGENTS.md](./packages/aws-durable-execution-sdk-js/AGENTS.md)
before you change the SDK. [ADR 0001](./docs/adr/0001-operation-tracking-and-plugin-hooks.md)
gives the reasons. A change that breaks a rule fails a contract test. Do not edit or delete a
contract test to make a change pass. To change a rule, propose a new ADR first.

### Formatting and linting

[Biome](https://biomejs.dev) handles both, for JavaScript, TypeScript and JSON:

```bash
npm run lint:fix   # format and lint, applying safe fixes
npm run lint       # check only, no writes
```

Formatting and lint errors both fail CI. A pre-commit hook runs `lint:fix` over
staged files, so in normal use this happens automatically — but `--no-verify`
skips it and CI does not.

Markdown and YAML are not formatted; Biome has no formatter for them and we do
not run a second tool just for that.

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
