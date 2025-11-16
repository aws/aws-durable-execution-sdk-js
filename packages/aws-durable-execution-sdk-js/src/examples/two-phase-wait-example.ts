/**
 * Example demonstrating the two-phase wait behavior
 *
 * Problem: Previously, when creating wait promises and using Promise.race,
 * the wait handler would immediately terminate, preventing the code from
 * reaching the await Promise.race([a,b]) line.
 *
 * Solution: Two-phase promises that defer execution until awaited.
 */

import { DurableContext } from "../types";

export async function twoPhaseWaitExample(context: DurableContext) {
  console.log("Creating wait promises (Phase 1)...");

  // Phase 1: Create promises but don't execute wait logic yet
  const waitA = context.wait({ seconds: 5 }); // Creates DurablePromise, no termination
  const waitB = context.wait({ seconds: 1 }); // Creates DurablePromise, no termination

  console.log("Promises created, now using Promise.race...");

  // Phase 2: When Promise.race calls .then() internally,
  // the wait logic executes and termination can occur
  const result = await Promise.race([waitA, waitB]);

  console.log("Promise.race completed:", result);
  return result;
}

export async function namedWaitExample(context: DurableContext) {
  console.log("Creating named wait promises...");

  // Phase 1: Create named promises
  const longWait = context.wait("long-operation", { seconds: 10 });
  const shortWait = context.wait("short-operation", { seconds: 2 });

  console.log("Using Promise.race with named waits...");

  // Phase 2: Execution happens when awaited
  const winner = await Promise.race([longWait, shortWait]);

  console.log("Winner:", winner);
  return winner;
}

export async function sequentialWaitExample(context: DurableContext) {
  console.log("Creating wait promise...");

  // Phase 1: Create promise
  const waitPromise = context.wait({ seconds: 3 });

  console.log("Doing other work before waiting...");
  // Do other synchronous work here

  console.log("Now actually waiting...");

  // Phase 2: Execute when awaited
  await waitPromise;

  console.log("Wait completed!");
}
