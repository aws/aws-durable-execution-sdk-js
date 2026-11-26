// @ts-check
/**
 * Groups integration examples so that one Lambda function serves each example
 * folder. Creating and updating ~125 functions took most of the deploy time.
 *
 * The group function runs integration-dispatch.cjs. The test runner wraps each
 * payload with the example name, and the dispatcher calls that example.
 *
 * The rule:
 * - An example with `ownFunction: true` in its config keeps its own function.
 *   ADDING_EXAMPLES.md says when to set it.
 * - The other examples of one folder share a function.
 * - The examples that are then alone in their folder share one "misc"
 *   function.
 *
 * generate-sam-template.ts fails the deploy when a group's settings differ.
 * The other missing flags fail in the tests.
 */

/**
 * @typedef {object} CatalogExample
 * @property {string} handler such as "wait.handler"
 * @property {string} path the absolute source path
 * @property {boolean} [ownFunction]
 */

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
 * @param {CatalogExample[]} examples
 * @returns {Map<string, string>} handler file to group id. Examples with
 *   ownFunction are not in the map.
 */
export function groupExamples(examples) {
  /** @type {Map<string, string[]>} */
  const byFolder = new Map();
  for (const example of examples) {
    if (example.ownFunction) continue;
    const folder = exampleFolder(example);
    const handlerFile = example.handler.replace(/\.handler$/, "");
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), handlerFile]);
  }

  /** @type {Map<string, string>} */
  const groups = new Map();
  for (const [folder, handlerFiles] of byFolder) {
    const groupId = handlerFiles.length < 2 ? "misc-group" : `${folder}-group`;
    for (const handlerFile of handlerFiles) groups.set(handlerFile, groupId);
  }
  return groups;
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
