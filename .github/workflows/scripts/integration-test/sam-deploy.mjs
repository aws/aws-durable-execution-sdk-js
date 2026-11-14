// @ts-check
/**
 * Retry and rollback recovery for the integration test `sam deploy`.
 * integration-test.js runs main() on import, so this logic lives here, where
 * integration-test.test.mjs can test it.
 */

/**
 * @param {number} attempt the attempt that just failed, from 1
 * @returns {number} the wait before the next attempt
 */
export function retryDelayMs(attempt) {
  return Math.min(15000 * attempt, 60000);
}

/**
 * Runs `run` until it succeeds, up to `maxAttempts` times.
 * @template T
 * @param {() => T | Promise<T>} run
 * @param {object} options
 * @param {number} [options.maxAttempts]
 * @param {() => void | Promise<void>} [options.beforeRetry] runs after a
 *   failed attempt, before the wait for the next one
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<T>}
 */
export async function retry(
  run,
  {
    maxAttempts = 5,
    beforeRetry,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console.warn,
  } = {},
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      await beforeRetry?.();
      const delayMs = retryDelayMs(attempt);
      log(
        `Command failed; retrying attempt ${attempt + 1}/${maxAttempts} in ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
  }
}

/**
 * @typedef {object} StackOps
 * @property {() => string | undefined} getStatus undefined if the stack does
 *   not exist
 * @property {() => void} deleteStack
 * @property {() => void} waitForDelete
 * @property {(message: string) => void} log
 */

/**
 * A stack whose first create failed is left in ROLLBACK_COMPLETE, and
 * CloudFormation cannot update it. So a retried deploy would fail the same
 * way every time. This deletes such a stack so the next attempt creates it
 * again. Pull requests create stacks often, and a create of ~250 resources
 * can fail on a transient error, such as a log group that CloudWatch Logs
 * does not report yet. A stack in any other status is left alone.
 * @param {StackOps} ops
 * @returns {boolean} true if the stack was deleted
 */
export function deleteIfRolledBack(ops) {
  if (ops.getStatus() !== "ROLLBACK_COMPLETE") return false;
  ops.log("Stack is in ROLLBACK_COMPLETE; deleting it to retry");
  ops.deleteStack();
  ops.waitForDelete();
  return true;
}

/**
 * Runs the deploy with retries. Before each retry, a rolled-back stack is
 * deleted.
 * @template T
 * @param {() => T | Promise<T>} deploy
 * @param {StackOps & { sleep?: (ms: number) => Promise<void> }} ops
 * @returns {Promise<T>}
 */
export function deployWithRollbackRecovery(deploy, ops) {
  return retry(deploy, {
    beforeRetry: () => {
      deleteIfRolledBack(ops);
    },
    sleep: ops.sleep,
    log: ops.log,
  });
}
