// @ts-check
//
// Unit tests for integration-test-names.mjs. Run locally with:
//   node --test .github/workflows/scripts/integration-test/*.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  baseFunctionName,
  pullRequestNumber,
  samStackName,
} from "./integration-test-names.mjs";
import { STACK_PATTERN } from "./cleanup-pr-stacks.mjs";

const pr = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_EVENT_NUMBER: "1222",
};
const prTarget = { ...pr, GITHUB_EVENT_NAME: "pull_request_target" };
const push = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push" };
const local = {};

describe("pullRequestNumber", () => {
  test("is the number for pull_request and pull_request_target", () => {
    assert.equal(pullRequestNumber(pr), "1222");
    assert.equal(pullRequestNumber(prTarget), "1222");
  });

  test("is undefined for a push and outside GitHub Actions", () => {
    assert.equal(pullRequestNumber(push), undefined);
    assert.equal(
      pullRequestNumber({ ...pr, GITHUB_ACTIONS: undefined }),
      undefined,
    );
  });

  test("throws when a pull request run has no number", () => {
    assert.throws(
      () => pullRequestNumber({ ...pr, GITHUB_EVENT_NUMBER: "" }),
      /GITHUB_EVENT_NUMBER/,
    );
  });
});

describe("samStackName", () => {
  test("a pull request gets its own stack", () => {
    assert.equal(
      samStackName("24.x", pr),
      "aws-durable-execution-sdk-js-integ-24x-pr-1222",
    );
    assert.equal(
      samStackName("22.x", prTarget),
      "aws-durable-execution-sdk-js-integ-22x-pr-1222",
    );
  });

  test("other runs share the runtime stack", () => {
    assert.equal(
      samStackName("24.x", push),
      "aws-durable-execution-sdk-js-integ-24x",
    );
    assert.equal(
      samStackName("24.x", local),
      "aws-durable-execution-sdk-js-integ-24x",
    );
  });

  test("cleanup matches pull request stacks and not the shared stack", () => {
    assert.match(samStackName("24.x", pr), STACK_PATTERN);
    assert.doesNotMatch(samStackName("24.x", push), STACK_PATTERN);
  });
});

describe("baseFunctionName", () => {
  const name = (
    /** @type {Record<string, string | undefined>} */ env,
    capacityProviderOnly = false,
  ) =>
    baseFunctionName({
      exampleName: "Step Basic",
      runtime: "24.x",
      capacityProviderOnly,
      env,
    });

  test("pull request functions end in -PR-<number>", () => {
    assert.equal(name(pr), "StepBasic-24x-NodeJS-PR-1222");
    assert.equal(name(prTarget), "StepBasic-24x-NodeJS-PR-1222");
  });

  test("push and local runs keep their names", () => {
    assert.equal(name(push), "StepBasic-24x-NodeJS");
    assert.equal(name(local), "StepBasic-24x-NodeJS-Local");
  });

  test("capacity provider functions get the suffix on pull_request only", () => {
    assert.equal(name(pr, true), "StepBasic-24x-NodeJS-PR-1222");
    assert.equal(name(prTarget, true), "StepBasic-24x-NodeJS");
    assert.equal(name(push, true), "StepBasic-24x-NodeJS");
  });
});
