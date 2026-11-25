// @ts-check
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  findInvokeTargets,
  groupExamples,
  groupFunctionName,
} from "./example-groups.mjs";

/**
 * @param {string} folder
 * @param {string} file
 * @param {object} [settings]
 */
const example = (folder, file, settings = {}) => ({
  handler: `${file}.handler`,
  path: `/repo/src/examples/${folder}/${file}/${file}.ts`,
  durableConfig: { ExecutionTimeout: 60, RetentionPeriodInDays: 7 },
  ...settings,
});

describe("groupExamples", () => {
  test("puts the examples of one folder in one group", () => {
    const groups = groupExamples(
      [example("map", "map-basic"), example("map", "map-large")],
      new Set(),
    );
    assert.deepEqual(Object.fromEntries(groups), {
      "map-basic": "map-group",
      "map-large": "map-group",
    });
  });

  test("leaves an example that is alone in its folder ungrouped", () => {
    const groups = groupExamples(
      [example("hello-world", "hello-world")],
      new Set(),
    );
    assert.equal(groups.size, 0);
  });

  test("leaves invoke targets ungrouped", () => {
    const groups = groupExamples(
      [
        example("wait", "wait"),
        example("wait", "wait-named"),
        example("wait", "wait-long"),
      ],
      new Set(["wait"]),
    );
    assert.deepEqual(Object.fromEntries(groups), {
      "wait-named": "wait-group",
      "wait-long": "wait-group",
    });
  });

  test("splits a folder by function settings", () => {
    const longTimeout = {
      durableConfig: { ExecutionTimeout: 900, RetentionPeriodInDays: 7 },
    };
    const groups = groupExamples(
      [
        example("step", "step-a"),
        example("step", "step-b"),
        example("step", "step-c", longTimeout),
        example("step", "step-d", longTimeout),
        example("step", "step-e", { lambdaTimeoutSeconds: 5 }),
      ],
      new Set(),
    );
    assert.deepEqual(Object.fromEntries(groups), {
      "step-a": "step-group",
      "step-b": "step-group",
      "step-c": "step-2-group",
      "step-d": "step-2-group",
    });
  });
});

describe("groupFunctionName", () => {
  test("is the group id in PascalCase", () => {
    assert.equal(
      groupFunctionName("wait-for-callback-group"),
      "WaitForCallbackGroup",
    );
  });
});

describe("findInvokeTargets", () => {
  test("finds the names passed to getFunctionName", () => {
    const targets = findInvokeTargets([
      `functionNameMap.getFunctionName("wait"),\n getFunctionName(\n  'step-basic')`,
    ]);
    assert.deepEqual([...targets], ["wait", "step-basic"]);
  });
});
