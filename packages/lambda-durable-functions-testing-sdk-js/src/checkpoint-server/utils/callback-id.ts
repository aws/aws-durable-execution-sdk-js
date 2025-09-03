import { randomUUID } from "node:crypto";
import { CallbackId, createCallbackId, ExecutionId } from "./tagged-strings";

export interface CallbackIdData {
  executionId: ExecutionId;
  operationId: string;
  token: string;
}

export function decodeCallbackId(callbackId: CallbackId): CallbackIdData {
  try {
    const decodedJson: unknown = JSON.parse(
      Buffer.from(callbackId, "base64").toString("utf-8")
    );

    // Validate the decoded data has the required fields
    if (
      !decodedJson ||
      typeof decodedJson !== "object" ||
      !("executionId" in decodedJson) ||
      !("operationId" in decodedJson) ||
      !("token" in decodedJson)
    ) {
      throw new Error("Invalid CallbackIdData format");
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return decodedJson as CallbackIdData;
  } catch (error) {
    // Re-throw with a more descriptive message
    throw new Error(
      `Failed to decode CallbackIdData : ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export function encodeCallbackId(
  callbackIdData: Omit<CallbackIdData, "token">
): CallbackId {
  return createCallbackId(
    Buffer.from(
      JSON.stringify({
        ...callbackIdData,
        token: randomUUID(),
      })
    ).toString("base64")
  );
}
