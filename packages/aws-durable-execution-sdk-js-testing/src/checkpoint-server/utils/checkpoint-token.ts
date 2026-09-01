import {
  CheckpointToken,
  createCheckpointToken,
  ExecutionId,
  InvocationId,
} from "./tagged-strings";

export interface CheckpointTokenData {
  executionId: ExecutionId;
  invocationId: InvocationId;
  token: string;
}

export function decodeCheckpointToken(
  checkpointToken: CheckpointToken,
): CheckpointTokenData {
  try {
    const decodedJson = JSON.parse(
      Buffer.from(checkpointToken, "base64").toString("utf-8"),
    );

    // Validate the decoded data has the required fields
    if (
      !decodedJson ||
      typeof decodedJson !== "object" ||
      !("executionId" in decodedJson) ||
      !("token" in decodedJson)
    ) {
      throw new Error("Invalid CheckpointTokenData format");
    }

    return decodedJson as CheckpointTokenData;
  } catch (error) {
    // Re-throw with a more descriptive message
    throw new Error(
      `Failed to decode checkpoint token: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

export function encodeCheckpointToken(
  checkpointTokenData: CheckpointTokenData,
): CheckpointToken {
  return createCheckpointToken(
    Buffer.from(JSON.stringify(checkpointTokenData)).toString("base64"),
  );
}
