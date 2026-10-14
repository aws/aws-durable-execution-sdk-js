import { LambdaServiceException } from "@aws-sdk/client-lambda";
import { OperationUpdate } from "@aws/durable-execution-sdk-js";

interface StringConstraint {
  kind: "string";
  required: boolean;
  minLength?: number;
  maxLength?: number;
  /** The pattern as the service shows it, without `^` and `$` anchors. */
  pattern?: string;
}

interface NumberConstraint {
  kind: "number";
  min: number;
  max: number;
}

type Constraint = StringConstraint | NumberConstraint;

/**
 * One constrained member of `OperationUpdate`.
 *
 * A member of an options structure is checked only when the structure is
 * present. So a required member of an absent structure is not an error.
 */
interface ConstrainedMember {
  /** The member's path in the service's message, after `member.`. */
  path: string;
  /** Returns the structure that holds the member, or undefined if it is absent. */
  container: (update: OperationUpdate) => object | undefined;
  /** Returns the member's value. */
  value: (update: OperationUpdate) => unknown;
  constraint: Constraint;
}

const OPERATION_ID: StringConstraint = {
  kind: "string",
  required: false,
  minLength: 1,
  maxLength: 64,
  pattern: "[a-zA-Z0-9-_]+",
};

/** The longest duration that a wait or a step retry delay can have. */
const MAX_DURATION_SECONDS = 31_622_400;

/** The longest callback timeout and heartbeat timeout. */
const MAX_CALLBACK_TIMEOUT_SECONDS = 99_999_999;

const topLevel = (update: OperationUpdate): object => update;

/**
 * The constrained members, in the order in which the service reports their
 * errors. This order was measured. It is not the order of the members in the
 * model.
 */
const CONSTRAINED_MEMBERS: ConstrainedMember[] = [
  {
    path: "chainedInvokeOptions.functionName",
    container: (update) => update.ChainedInvokeOptions,
    value: (update) => update.ChainedInvokeOptions?.FunctionName,
    constraint: {
      kind: "string",
      required: true,
      minLength: 1,
      maxLength: 256,
      pattern:
        "(arn:(aws[a-zA-Z-]*)?:lambda:)?((eusc-)?[a-z]{2}((-gov)|(-iso([a-z]?)))?-[a-z]+-\\d{1}:)?(\\d{12}:)?(function:)?([a-zA-Z0-9-_\\.]+)(:(\\$LATEST(\\.PUBLISHED)?|[a-zA-Z0-9-_]+))?",
    },
  },
  {
    path: "chainedInvokeOptions.tenantId",
    container: (update) => update.ChainedInvokeOptions,
    value: (update) => update.ChainedInvokeOptions?.TenantId,
    constraint: {
      kind: "string",
      required: false,
      minLength: 1,
      maxLength: 256,
      pattern: "[a-zA-Z0-9\\._:\\/=+\\-@ ]+",
    },
  },
  {
    path: "callbackOptions.timeoutSeconds",
    container: (update) => update.CallbackOptions,
    value: (update) => update.CallbackOptions?.TimeoutSeconds,
    constraint: { kind: "number", min: 0, max: MAX_CALLBACK_TIMEOUT_SECONDS },
  },
  {
    path: "callbackOptions.heartbeatTimeoutSeconds",
    container: (update) => update.CallbackOptions,
    value: (update) => update.CallbackOptions?.HeartbeatTimeoutSeconds,
    constraint: { kind: "number", min: 0, max: MAX_CALLBACK_TIMEOUT_SECONDS },
  },
  {
    path: "type",
    container: topLevel,
    value: (update) => update.Type,
    constraint: { kind: "string", required: true },
  },
  {
    path: "parentId",
    container: topLevel,
    value: (update) => update.ParentId,
    constraint: OPERATION_ID,
  },
  {
    path: "waitOptions.waitSeconds",
    container: (update) => update.WaitOptions,
    value: (update) => update.WaitOptions?.WaitSeconds,
    constraint: { kind: "number", min: 1, max: MAX_DURATION_SECONDS },
  },
  {
    path: "stepOptions.nextAttemptDelaySeconds",
    container: (update) => update.StepOptions,
    value: (update) => update.StepOptions?.NextAttemptDelaySeconds,
    constraint: { kind: "number", min: 1, max: MAX_DURATION_SECONDS },
  },
  {
    path: "name",
    container: topLevel,
    value: (update) => update.Name,
    constraint: {
      kind: "string",
      required: false,
      minLength: 1,
      maxLength: 256,
      pattern: "[\\x20-\\x7E]+",
    },
  },
  {
    path: "action",
    container: topLevel,
    value: (update) => update.Action,
    constraint: { kind: "string", required: true },
  },
  {
    path: "subType",
    container: topLevel,
    value: (update) => update.SubType,
    constraint: {
      kind: "string",
      required: false,
      minLength: 1,
      maxLength: 32,
      pattern: "[a-zA-Z0-9-_]+",
    },
  },
  {
    path: "id",
    container: topLevel,
    value: (update) => update.Id,
    constraint: { ...OPERATION_ID, required: true },
  },
];

/** The service lists at most this many errors, and counts only those. */
const MAX_REPORTED_ERRORS = 10;

/**
 * The members in the order in which the AWS SDK for JavaScript writes them to
 * the request body. The SDK writes members in alphabetical order. The service
 * reads the body in this order, and reports only the first member it cannot
 * read.
 */
const MEMBERS_IN_BODY_ORDER = [...CONSTRAINED_MEMBERS].sort((a, b) => {
  const left = a.path.toLowerCase();
  const right = b.path.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
});

/** The service reads an integer member as a 32-bit Java `Integer`. */
const MIN_INTEGER = -2_147_483_648;
const MAX_INTEGER = 2_147_483_647;

/**
 * Returns the integer that the service reads for a finite number. The service
 * discards the fractional part, so 1.5 becomes 1 and 0.5 becomes 0. It
 * clamps a value outside the 32-bit range to the nearest bound.
 */
function toServiceInteger(value: number): number {
  return Math.min(MAX_INTEGER, Math.max(MIN_INTEGER, Math.trunc(value)));
}

/**
 * Returns the token name that the service reports for a JSON value of the
 * wrong type. The AWS SDK for JavaScript writes `NaN` and `Infinity` as
 * strings, so the service reads them as `STRING_VALUE`.
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

/**
 * Returns the service's message for a member value that it cannot read as the
 * member's type, or undefined if it can read the value.
 */
function serializationError(
  value: unknown,
  constraint: Constraint,
): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return "Start of list found where not expected";
  }
  if (typeof value === "object") {
    return "Start of structure or map found where not expected.";
  }
  if (
    typeof value !== "number" &&
    typeof value !== "string" &&
    typeof value !== "boolean"
  ) {
    return undefined;
  }
  if (constraint.kind === "string") {
    return typeof value === "string"
      ? undefined
      : `${jsonToken(value)} can not be converted to a String`;
  }
  return typeof value === "number" && Number.isFinite(value)
    ? undefined
    : `${jsonToken(value)} can not be converted to an Integer`;
}

/**
 * Throws the service's `SerializationException` when a member has the wrong
 * JSON type. The service reads the request body before it checks the model.
 * So a member of the wrong type fails the request before any constraint
 * error. The message names only the first such member, and not its position.
 */
function validateUpdateSerialization(updates: OperationUpdate[]): void {
  for (const update of updates) {
    for (const member of MEMBERS_IN_BODY_ORDER) {
      if (member.container(update) == null) {
        continue;
      }
      const message = serializationError(
        member.value(update),
        member.constraint,
      );
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
}

function stringErrors(
  value: string,
  at: string,
  constraint: StringConstraint,
): string[] {
  const errors: string[] = [];
  if (
    constraint.minLength !== undefined &&
    value.length < constraint.minLength
  ) {
    errors.push(
      `${at} Member must have length greater than or equal to ${constraint.minLength}`,
    );
  }
  if (
    constraint.maxLength !== undefined &&
    value.length > constraint.maxLength
  ) {
    errors.push(
      `${at} Member must have length less than or equal to ${constraint.maxLength}`,
    );
  }
  // The service checks the pattern even when the length check fails. So an
  // empty string gets both a length error and a pattern error.
  if (
    constraint.pattern !== undefined &&
    !new RegExp(`^${constraint.pattern}$`).test(value)
  ) {
    errors.push(
      `${at} Member must satisfy regular expression pattern: ${constraint.pattern}`,
    );
  }
  return errors;
}

function numberErrors(
  value: number,
  at: string,
  constraint: NumberConstraint,
): string[] {
  if (value < constraint.min) {
    return [
      `${at} Member must have value greater than or equal to ${constraint.min}`,
    ];
  }
  if (value > constraint.max) {
    return [
      `${at} Member must have value less than or equal to ${constraint.max}`,
    ];
  }
  return [];
}

function memberErrors(
  update: OperationUpdate,
  path: string,
  member: ConstrainedMember,
): string[] {
  if (member.container(update) == null) {
    return [];
  }

  const value = member.value(update);
  const { constraint } = member;
  if (value == null) {
    return constraint.kind === "string" && constraint.required
      ? [
          `Value null at '${path}' failed to satisfy constraint: Member must not be null`,
        ]
      : [];
  }

  if (constraint.kind === "string" && typeof value === "string") {
    const at = `Value '${value}' at '${path}' failed to satisfy constraint:`;
    return stringErrors(value, at, constraint);
  }
  if (constraint.kind === "number" && typeof value === "number") {
    // The service checks the integer that it read, and shows that integer.
    const integer = toServiceInteger(value);
    const at = `Value '${integer}' at '${path}' failed to satisfy constraint:`;
    return numberErrors(integer, at, constraint);
  }
  return [];
}

/**
 * Validates every update against the constraints of the service model.
 *
 * The service first reads the request body. A member of the wrong JSON type
 * fails the request with HTTP 400 `SerializationException`. A number for an
 * integer member is read without its fractional part.
 *
 * The service then checks the request against its model before it applies any
 * update. One invalid member rejects the whole request with HTTP 400
 * `ValidationException`. The message lists every failed constraint, and
 * names each update by its 1-based position in `Updates`. The message
 * lists at most 10 errors.
 *
 * The messages and their order match the responses of
 * `CheckpointDurableExecution` in us-east-1. The service also checks that
 * `Type` and `Action` are known enum values. That check is not reproduced
 * here, so an unknown value fails later with `Invalid operation type.` or
 * `Invalid action for the given operation type.`.
 *
 * @param updates - The updates of one checkpoint request
 * @throws {LambdaServiceException} A `SerializationException` with HTTP
 * status 400, when a member has the wrong type. A `ValidationException` with
 * HTTP status 400, when any member is invalid.
 */
export function validateUpdateModel(updates: OperationUpdate[]): void {
  validateUpdateSerialization(updates);

  const errors: string[] = [];
  updates.forEach((update, index) => {
    for (const member of CONSTRAINED_MEMBERS) {
      errors.push(
        ...memberErrors(
          update,
          `updates.${index + 1}.member.${member.path}`,
          member,
        ),
      );
    }
  });

  if (errors.length === 0) {
    return;
  }
  const reported = errors.slice(0, MAX_REPORTED_ERRORS);
  const count =
    reported.length === 1
      ? "1 validation error detected"
      : `${reported.length} validation errors detected`;
  throw new LambdaServiceException({
    name: "ValidationException",
    $fault: "client",
    $metadata: { httpStatusCode: 400 },
    message: `${count}: ${reported.join("; ")}`,
  });
}
