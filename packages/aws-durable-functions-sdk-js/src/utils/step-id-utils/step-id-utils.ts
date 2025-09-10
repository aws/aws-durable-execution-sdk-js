import { createHash } from "crypto";

const HASH_LENGTH = 16;

/**
 * Creates an MD5 hash of the input string for better performance than SHA-256
 * @param input The string to hash
 * @returns The truncated hexadecimal hash string
 */
export const hashId = (input: string): string => {
  return createHash("md5")
    .update(input)
    .digest("hex")
    .substring(0, HASH_LENGTH);
};

/**
 * Helper function to get step data using the original stepId
 * This function handles the hashing internally so callers don't need to worry about it
 * @param stepData The stepData record from context
 * @param stepId The original stepId (will be hashed internally)
 * @returns The operation data or undefined if not found
 */
export const getStepData = (stepData: Record<string, any>, stepId: string) => {
  const hashedId = hashId(stepId);
  return stepData[hashedId];
};
