import { LambdaServiceException } from "@aws-sdk/client-lambda";
import { OperationUpdate } from "@aws/durable-execution-sdk-js";

/**
 * The JSON type of one member of the request body, as the service reads it.
 */
type WireType =
  | "string"
  | "integer"
  | "boolean"
  | { structure: Record<string, WireType> }
  | { list: WireType };

/**
 * The complete wire schema of `OperationUpdate`.
 *
 * The service reads the members of each structure in alphabetical order of
 * their names. It does not read them in the order of the request body. So the
 * members are listed here in alphabetical order. The checks below visit them
 * in this order.
 */
const OPERATION_UPDATE: WireType = {
  structure: {
    Action: "string",
    CallbackOptions: {
      structure: {
        HeartbeatTimeoutSeconds: "integer",
        TimeoutSeconds: "integer",
      },
    },
    ChainedInvokeOptions: {
      structure: { FunctionName: "string", TenantId: "string" },
    },
    ContextOptions: { structure: { ReplayChildren: "boolean" } },
    Error: {
      structure: {
        ErrorData: "string",
        ErrorMessage: "string",
        ErrorType: "string",
        StackTrace: { list: "string" },
      },
    },
    Id: "string",
    Name: "string",
    ParentId: "string",
    Payload: "string",
    StepOptions: { structure: { NextAttemptDelaySeconds: "integer" } },
    SubType: "string",
    Type: "string",
    WaitOptions: { structure: { WaitSeconds: "integer" } },
  },
};

const OBJECT_NOT_EXPECTED =
  "Start of structure or map found where not expected.";
const ARRAY_NOT_EXPECTED = "Start of list found where not expected";

/**
 * Returns the token name that the service reports for a JSON scalar. The AWS
 * SDK for JavaScript writes `NaN` and `Infinity` as strings. So the service
 * reads them as `STRING_VALUE`.
 */
function jsonToken(value: number | string | boolean): string {
  if (typeof value === "boolean") {
    return value ? "TRUE_VALUE" : "FALSE_VALUE";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return "NUMBER_VALUE";
  }
  return "STRING_VALUE";
}

function isScalar(value: unknown): value is number | string | boolean {
  return (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  );
}

/**
 * Returns the service's message for a scalar member that it cannot read, or
 * undefined if it can read the value.
 */
function scalarError(
  value: unknown,
  type: "string" | "integer" | "boolean",
): string | undefined {
  if (Array.isArray(value)) {
    return ARRAY_NOT_EXPECTED;
  }
  if (typeof value === "object") {
    return OBJECT_NOT_EXPECTED;
  }
  if (!isScalar(value)) {
    return undefined;
  }
  switch (type) {
    case "string":
      return typeof value === "string"
        ? undefined
        : `${jsonToken(value)} can not be converted to a String`;
    case "integer":
      return typeof value === "number" && Number.isFinite(value)
        ? undefined
        : `${jsonToken(value)} can not be converted to an Integer`;
    case "boolean":
      // The service also reads a string as a Boolean.
      return typeof value === "number" && Number.isFinite(value)
        ? "NUMBER_VALUE can not be converted to a Boolean"
        : undefined;
  }
}

/**
 * Returns the service's message for the first value in `value` that it
 * cannot read as `type`, or undefined if it can read every value.
 *
 * The service reads `null` as an absent member. It reads an array where it
 * expects a structure without an error, and then reads no members from it.
 */
function firstError(value: unknown, type: WireType): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof type === "string") {
    return scalarError(value, type);
  }
  if ("list" in type) {
    if (Array.isArray(value)) {
      for (const element of value) {
        const error = firstError(element, type.list);
        if (error !== undefined) {
          return error;
        }
      }
      return undefined;
    }
    return typeof value === "object"
      ? OBJECT_NOT_EXPECTED
      : "Expected list or null";
  }
  if (Array.isArray(value)) {
    return undefined;
  }
  if (typeof value !== "object") {
    return "Expected null";
  }
  const record = value as Record<string, unknown>;
  for (const [member, memberType] of Object.entries(type.structure)) {
    const error = firstError(record[member], memberType);
    if (error !== undefined) {
      return error;
    }
  }
  return undefined;
}

/**
 * Throws the service's `SerializationException` when a member of an update
 * has the wrong JSON type.
 *
 * The service reads the request body before it checks the model. So a member
 * of the wrong type fails the request before any constraint error. The
 * service reports only the first such member. Its message names the JSON
 * token and the expected type, but not the member or the update.
 *
 * The messages and the order were recorded from `CheckpointDurableExecution`
 * in us-east-1.
 *
 * @param updates - The updates of one checkpoint request
 * @throws {LambdaServiceException} A `SerializationException` with HTTP
 * status 400, when a member has the wrong type
 */
export function validateUpdateSerialization(updates: OperationUpdate[]): void {
  for (const update of updates) {
    const message = firstError(update, OPERATION_UPDATE);
    if (message !== undefined) {
      throw new LambdaServiceException({
        name: "SerializationException",
        $fault: "client",
        $metadata: { httpStatusCode: 400 },
        message,
      });
    }
  }
}
