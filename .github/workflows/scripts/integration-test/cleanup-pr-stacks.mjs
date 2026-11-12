#!/usr/bin/env node
/**
 * Deletes the integration test stacks of closed pull requests.
 *
 * Each pull request deploys to its own stack per runtime, named
 * aws-durable-execution-sdk-js-integ-<runtime>-pr-<number> (see
 * getSamStackName in integration-test.js). This script lists those stacks,
 * asks GitHub which pull requests are closed, and deletes their stacks.
 *
 * It checks every stack, not only the pull request that was just closed. So a
 * stack that an earlier cleanup missed (a failed job, or a deploy that ended
 * after the pull request closed) is deleted the next time any pull request
 * closes.
 *
 * Environment: AWS_REGION, GITHUB_REPOSITORY, GITHUB_TOKEN.
 * Pass --dry-run to only list what would be deleted.
 */

import { execFileSync } from "node:child_process";

const STACK_PATTERN = /^aws-durable-execution-sdk-js-integ-[a-z0-9]+-pr-(\d+)$/;
// DELETE_COMPLETE stacks are already gone, and DELETE_IN_PROGRESS stacks are
// being deleted. Every other status can be deleted.
const LIVE_STATUSES = [
  "CREATE_IN_PROGRESS",
  "CREATE_FAILED",
  "CREATE_COMPLETE",
  "ROLLBACK_IN_PROGRESS",
  "ROLLBACK_FAILED",
  "ROLLBACK_COMPLETE",
  "DELETE_FAILED",
  "UPDATE_IN_PROGRESS",
  "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS",
  "UPDATE_COMPLETE",
  "UPDATE_FAILED",
  "UPDATE_ROLLBACK_IN_PROGRESS",
  "UPDATE_ROLLBACK_FAILED",
  "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS",
  "UPDATE_ROLLBACK_COMPLETE",
  "REVIEW_IN_PROGRESS",
  "IMPORT_IN_PROGRESS",
  "IMPORT_COMPLETE",
  "IMPORT_ROLLBACK_IN_PROGRESS",
  "IMPORT_ROLLBACK_FAILED",
  "IMPORT_ROLLBACK_COMPLETE",
];

const dryRun = process.argv.includes("--dry-run");
const region = process.env.AWS_REGION;
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!region || !repository || !token) {
  throw new Error(
    "AWS_REGION, GITHUB_REPOSITORY and GITHUB_TOKEN are required",
  );
}

/** @param {string[]} args */
function aws(args) {
  return execFileSync(
    "aws",
    [...args, "--region", region, "--output", "json"],
    {
      encoding: "utf8",
    },
  );
}

/** @returns {string[]} */
function listPullRequestStacks() {
  const output = aws([
    "cloudformation",
    "list-stacks",
    "--stack-status-filter",
    ...LIVE_STATUSES,
    "--query",
    "StackSummaries[].StackName",
  ]);
  return JSON.parse(output).filter((/** @type {string} */ name) =>
    STACK_PATTERN.test(name),
  );
}

/** @param {string} number */
async function isClosed(number) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/pulls/${number}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub returned ${response.status} for pull request #${number}`,
    );
  }
  const pullRequest = await response.json();
  return pullRequest.state === "closed";
}

const stacks = listPullRequestStacks();
console.log(`Found ${stacks.length} pull request stack(s)`);

/** @type {Map<string, boolean>} */
const closedByNumber = new Map();
const toDelete = [];
for (const stack of stacks) {
  const number = /** @type {string} */ (STACK_PATTERN.exec(stack)?.[1]);
  if (!closedByNumber.has(number)) {
    closedByNumber.set(number, await isClosed(number));
  }
  if (closedByNumber.get(number)) toDelete.push(stack);
}

console.log(
  toDelete.length === 0
    ? "No stacks of closed pull requests"
    : `Stacks of closed pull requests:\n${toDelete.map((s) => `  ${s}`).join("\n")}`,
);
if (dryRun || toDelete.length === 0) process.exit(0);

// Start every delete first, then wait. A stack takes a few minutes to delete.
for (const stack of toDelete) {
  aws(["cloudformation", "delete-stack", "--stack-name", stack]);
  console.log(`Started deleting ${stack}`);
}

const failures = [];
for (const stack of toDelete) {
  try {
    aws([
      "cloudformation",
      "wait",
      "stack-delete-complete",
      "--stack-name",
      stack,
    ]);
    console.log(`Deleted ${stack}`);
  } catch (error) {
    failures.push(stack);
    console.error(`Could not delete ${stack}: ${error}`);
  }
}

if (failures.length > 0) {
  throw new Error(`Could not delete ${failures.length} stack(s): ${failures}`);
}
