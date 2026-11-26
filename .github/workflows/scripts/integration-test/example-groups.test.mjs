// @ts-check
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { groupExamples, groupFunctionName } from "./example-groups.mjs";

/**
 * @param {string} folder
 * @param {string} file
 * @param {object} [config]
 */
const example = (folder, file, config = {}) => ({
  handler: `${file}.handler`,
  path: `/repo/src/examples/${folder}/${file}/${file}.ts`,
  ...config,
});

describe("groupExamples", () => {
  test("puts the examples of one folder in one group", () => {
    const groups = groupExamples([
      example("map", "map-basic"),
      example("map", "map-large"),
    ]);
    assert.deepEqual(Object.fromEntries(groups), {
      "map-basic": "map-group",
      "map-large": "map-group",
    });
  });

  test("leaves an example with ownFunction ungrouped", () => {
    const groups = groupExamples([
      example("wait", "wait", { ownFunction: true }),
      example("wait", "wait-named"),
      example("wait", "wait-long"),
    ]);
    assert.deepEqual(Object.fromEntries(groups), {
      "wait-named": "wait-group",
      "wait-long": "wait-group",
    });
  });

  test("puts examples that are alone in their folder in one misc group", () => {
    const groups = groupExamples([
      example("hello-world", "hello-world"),
      example("multiple-waits", "multiple-waits"),
      example("non-durable", "non-durable", { ownFunction: true }),
    ]);
    assert.deepEqual(Object.fromEntries(groups), {
      "hello-world": "misc-group",
      "multiple-waits": "misc-group",
    });
  });

  test("puts the examples that are alone in their folder in misc", () => {
    const groups = groupExamples([
      example("hello-world", "hello-world"),
      example("map", "map-basic"),
      example("map", "map-large"),
    ]);
    assert.equal(groups.get("hello-world"), "misc-group");
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
