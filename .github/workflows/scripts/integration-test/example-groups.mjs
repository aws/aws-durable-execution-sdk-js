// @ts-check
/**
 * Groups integration examples so that one Lambda function serves each example
 * folder. Creating and updating ~125 functions took most of the deploy time.
 *
 * The group function runs integration-dispatch.cjs. The test runner wraps each
 * payload with the example name, and the dispatcher calls that example.
 *
 * Some examples stay in their own function:
 * - Examples that another example invokes by function name. The caller builds
 *   the payload, so it carries no example name.
 * - Examples whose test builds its own CloudDurableTestRunner, which does not
 *   wrap the payload.
 * - Examples whose function settings differ from the rest of their folder.
 *   A function has one timeout, one durable config and one environment.
 *
 * Examples with no other example of the same folder and settings share one
 * "misc" function, when their settings are equal.
 */

import { basename } from "node:path";

/**
 * @typedef {object} CatalogExample
 * @property {string} handler such as "wait.handler"
 * @property {string} path the absolute source path
 * @property {unknown} [durableConfig]
 * @property {number} [lambdaTimeoutSeconds]
 * @property {boolean} [usesMicrovm]
 */

/**
 * The function settings that the template takes from an example. Examples
 * share a function only when these are equal.
 * @param {CatalogExample} example
 */
function settingsKey(example) {
  return JSON.stringify([
    example.durableConfig ?? null,
    example.lambdaTimeoutSeconds ?? null,
    !!example.usesMicrovm,
  ]);
}

/**
 * The folder under src/examples that holds the example.
 * @param {CatalogExample} example
 */
function exampleFolder(example) {
  const parts = example.path.split(/[\\/]/);
  const index = parts.lastIndexOf("examples");
  return parts[index + 1];
}

/**
 * Examples that keep their own function, and why.
 */
const OWN_FUNCTION = new Map([
  // Has its own entry in EXAMPLE_CONFIGS in generate-sam-template.ts.
  // generate-sam-template.ts fails if a grouped example has other settings,
  // so this entry cannot fall behind without a failed deploy.
  ["steps-with-retry", "custom settings"],
  // Sends a 6 MB input. Lambda then does not put the input in the
  // invocation event, so the dispatcher cannot read the example name.
  ["large-payload", "input not in the invocation event"],
]);

/**
 * @param {CatalogExample[]} examples
 * @param {Set<string>} ownFunction handler files that keep their own function
 * @returns {Map<string, string>} handler file to group id, for grouped
 *   examples only. Examples not in the map keep their own function.
 */
export function groupExamples(examples, ownFunction) {
  /** @type {Map<string, string[]>} */
  const members = new Map();
  for (const example of examples) {
    const handlerFile = example.handler.replace(/\.handler$/, "");
    if (ownFunction.has(handlerFile) || OWN_FUNCTION.has(handlerFile)) {
      continue;
    }
    const key = `${exampleFolder(example)}\n${settingsKey(example)}`;
    members.set(key, [...(members.get(key) ?? []), handlerFile]);
  }

  /** @type {Map<string, string>} */
  const groups = new Map();
  /** @type {Map<string, number>} */
  const groupsPerFolder = new Map();
  /** @type {Map<string, string[]>} */
  const alone = new Map();
  for (const [key, handlerFiles] of members) {
    const [folder, settings] = key.split("\n");
    if (handlerFiles.length < 2) {
      // Examples alone in their folder and settings share a "misc" function.
      alone.set(settings, [...(alone.get(settings) ?? []), ...handlerFiles]);
      continue;
    }
    addGroup(groups, groupsPerFolder, folder, handlerFiles);
  }
  for (const handlerFiles of alone.values()) {
    if (handlerFiles.length < 2) continue;
    addGroup(groups, groupsPerFolder, "misc", handlerFiles);
  }
  return groups;
}

/**
 * @param {Map<string, string>} groups handler file to group id
 * @param {Map<string, number>} groupsPerFolder
 * @param {string} folder
 * @param {string[]} handlerFiles
 */
function addGroup(groups, groupsPerFolder, folder, handlerFiles) {
  const count = (groupsPerFolder.get(folder) ?? 0) + 1;
  groupsPerFolder.set(folder, count);
  const groupId = `${folder}${count > 1 ? `-${count}` : ""}-group`;
  for (const handlerFile of handlerFiles) groups.set(handlerFile, groupId);
}

/**
 * The name part of a group's function, such as "WaitForCallbackGroup" for
 * "wait-for-callback-group".
 * @param {string} groupId
 */
export function groupFunctionName(groupId) {
  return groupId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * The examples that need their own function, found in the test files:
 * - names passed to functionNameMap.getFunctionName("..."), since another
 *   example invokes them by function name
 * - examples whose test builds its own CloudDurableTestRunner, since that
 *   runner does not wrap the payload. The test file is named
 *   <example>.test.ts.
 * @param {{ path: string, source: string }[]} testFiles
 * @returns {Set<string>} handler files
 */
export function findOwnFunctionExamples(testFiles) {
  /** @type {Set<string>} */
  const examples = new Set();
  for (const { path, source } of testFiles) {
    for (const match of source.matchAll(
      /getFunctionName\(\s*["'`]([^"'`]+)["'`]/g,
    )) {
      examples.add(match[1]);
    }
    if (/new CloudDurableTestRunner\b/.test(source)) {
      examples.add(basename(path, ".test.ts"));
    }
  }
  return examples;
}
