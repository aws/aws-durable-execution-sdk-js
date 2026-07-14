import { createHash } from "crypto";
import { Operation } from "@aws-sdk/client-lambda";

const HASH_LENGTH = 16;

// Step IDs are stable strings within an execution and hashing is pure, so
// results are memoized. When the bound is reached the cache is cleared and
// rebuilt rather than frozen, keeping amortized caching for map-heavy
// workloads that exceed it (an occasional full re-hash beats paying full
// hash cost for every new ID forever).
// Note: module-global, so it persists across warm Lambda invocations —
// beneficial, since step IDs repeat across replays of the same function.
const MAX_HASH_CACHE_SIZE = 10_000;
const hashCache = new Map<string, string>();

/**
 * Creates an MD5 hash of the input string for better performance than SHA-256.
 * Results are memoized since IDs repeat frequently in hot paths (checkpoint
 * batching, step data lookups, status-change resolution).
 * @param input - The string to hash
 * @returns The truncated hexadecimal hash string
 */
export const hashId = (input: string): string => {
  let hash = hashCache.get(input);
  if (hash === undefined) {
    hash = createHash("md5")
      .update(input)
      .digest("hex")
      .substring(0, HASH_LENGTH);
    if (hashCache.size >= MAX_HASH_CACHE_SIZE) {
      hashCache.clear();
    }
    hashCache.set(input, hash);
  }
  return hash;
};

/**
 * Helper function to get step data using the original stepId
 * This function handles the hashing internally so callers don't need to worry about it
 * @param stepData - The stepData record from context
 * @param stepId - The original stepId (will be hashed internally)
 * @returns The operation data or undefined if not found
 */
export const getStepData = (
  stepData: Record<string, Operation>,
  stepId: string,
): Operation | undefined => {
  const hashedId = hashId(stepId);
  return stepData[hashedId];
};
