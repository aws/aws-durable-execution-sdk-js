#!/usr/bin/env node
// @ts-check
/**
 * Deletes the integration test stacks of closed pull requests.
 *
 * Each pull request deploys to its own stack per runtime, named
 * aws-durable-execution-sdk-js-integ-<runtime>-pr-<number> (see
 * integration-test-names.mjs). This script lists those stacks, asks GitHub
 * which pull requests are closed, and deletes their stacks.
 *
 * It checks every stack, not only the pull request that was just closed. So a
 * stack that an earlier cleanup missed (a failed job, a stack that was busy,
 * or a deploy that ended after the pull request closed) is deleted the next
 * time any pull request closes.
 *
 * Environment: AWS_REGION, GITHUB_REPOSITORY, GITHUB_TOKEN.
 */

import { execFileSync } from "node:child_process";

export const STACK_PATTERN =
  /^aws-durable-execution-sdk-js-integ-[a-z0-9]+-pr-(\d+)$/;

// Stacks that CloudFormation can delete now. A stack in most *_IN_PROGRESS
// statuses rejects DeleteStack, so it is left for the next cleanup.
// REVIEW_IN_PROGRESS is the exception: a first deploy that stopped after it
// created its change set leaves the stack there, and the status never moves
// on by itself. DELETE_COMPLETE stacks are already gone.
export const DELETABLE_STATUSES = [
  "CREATE_FAILED",
  "CREATE_COMPLETE",
  "ROLLBACK_FAILED",
  "ROLLBACK_COMPLETE",
  "DELETE_FAILED",
  "UPDATE_COMPLETE",
  "UPDATE_FAILED",
  "UPDATE_ROLLBACK_FAILED",
  "UPDATE_ROLLBACK_COMPLETE",
  "REVIEW_IN_PROGRESS",
  "IMPORT_COMPLETE",
  "IMPORT_ROLLBACK_FAILED",
  "IMPORT_ROLLBACK_COMPLETE",
];

/**
 * @typedef {object} CleanupDeps
 * @property {() => string[]} listStacks stack names in DELETABLE_STATUSES
 * @property {(number: string) => Promise<boolean>} isClosed
 * @property {(stack: string) => void} startDelete
 * @property {(stack: string) => void} waitForDelete
 * @property {(message: string) => void} log
 */

/**
 * Deletes the pull request stacks whose pull request is closed. A stack that
 * fails to delete does not stop the others.
 * @param {CleanupDeps} deps
 * @returns {Promise<{ deleted: string[], failed: string[] }>}
 */
export async function cleanupClosedPullRequestStacks(deps) {
  const stacks = deps.listStacks().filter((name) => STACK_PATTERN.test(name));
  deps.log(`Found ${stacks.length} pull request stack(s)`);

  /** @type {Map<string, boolean>} */
  const closedByNumber = new Map();
  const toDelete = [];
  for (const stack of stacks) {
    const number = /** @type {string} */ (STACK_PATTERN.exec(stack)?.[1]);
    if (!closedByNumber.has(number)) {
      closedByNumber.set(number, await deps.isClosed(number));
    }
    if (closedByNumber.get(number)) toDelete.push(stack);
  }

  // Start every delete first, then wait. A stack takes a few minutes.
  const failed = [];
  const started = [];
  for (const stack of toDelete) {
    try {
      deps.startDelete(stack);
      started.push(stack);
      deps.log(`Started deleting ${stack}`);
    } catch (error) {
      failed.push(stack);
      deps.log(`Could not start deleting ${stack}: ${error}`);
    }
  }

  const deleted = [];
  for (const stack of started) {
    try {
      deps.waitForDelete(stack);
      deleted.push(stack);
      deps.log(`Deleted ${stack}`);
    } catch (error) {
      failed.push(stack);
      deps.log(`Could not delete ${stack}: ${error}`);
    }
  }
  return { deleted, failed };
}

/**
 * @param {string} region
 * @param {(file: string, args: string[]) => string} [run] runs the aws CLI
 * @returns {Pick<CleanupDeps, "listStacks" | "startDelete" | "waitForDelete">}
 */
export function awsCli(
  region,
  run = (file, args) => execFileSync(file, args, { encoding: "utf8" }),
) {
  const aws = (/** @type {string[]} */ args) =>
    run("aws", [...args, "--region", region, "--output", "json"]);
  return {
    listStacks: () =>
      JSON.parse(
        aws([
          "cloudformation",
          "list-stacks",
          "--stack-status-filter",
          ...DELETABLE_STATUSES,
          "--query",
          "StackSummaries[].StackName",
        ]),
      ),
    startDelete: (stack) => {
      aws(["cloudformation", "delete-stack", "--stack-name", stack]);
    },
    waitForDelete: (stack) => {
      aws([
        "cloudformation",
        "wait",
        "stack-delete-complete",
        "--stack-name",
        stack,
      ]);
    },
  };
}

/**
 * @param {string} repository
 * @param {string} token
 * @param {typeof fetch} [fetchFn]
 * @returns {(number: string) => Promise<boolean>}
 */
export function gitHubIsClosed(repository, token, fetchFn = fetch) {
  return async (number) => {
    const response = await fetchFn(
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
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const region = process.env.AWS_REGION;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!region || !repository || !token) {
    throw new Error(
      "AWS_REGION, GITHUB_REPOSITORY and GITHUB_TOKEN are required",
    );
  }
  const { failed } = await cleanupClosedPullRequestStacks({
    ...awsCli(region),
    isClosed: gitHubIsClosed(repository, token),
    log: console.log,
  });
  if (failed.length > 0) {
    throw new Error(
      `Could not delete ${failed.length} stack(s): ${failed.join(", ")}`,
    );
  }
}
