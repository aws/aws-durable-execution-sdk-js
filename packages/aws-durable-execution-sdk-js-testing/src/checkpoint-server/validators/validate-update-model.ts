import { LambdaServiceException } from "@aws-sdk/client-lambda";
import { OperationUpdate } from "@aws/durable-execution-sdk-js";

interface StringConstraint {
  required: boolean;
  minLength?: number;
  maxLength?: number;
  /** The pattern as the service shows it, without `^` and `$` anchors. */
  pattern?: string;
}

const OPERATION_ID: StringConstraint = {
  required: false,
  minLength: 1,
  maxLength: 64,
  pattern: "[a-zA-Z0-9-_]+",
};

/**
 * The constrained members of `OperationUpdate`, in the order in which the
 * service reports their errors. This order was measured. It is not the
 * order of the members in the model.
 */
const CONSTRAINED_MEMBERS: [keyof OperationUpdate, string, StringConstraint][] =
  [
    ["Type", "type", { required: true }],
    ["ParentId", "parentId", OPERATION_ID],
    [
      "Name",
      "name",
      {
        required: false,
        minLength: 1,
        maxLength: 256,
        pattern: "[\\x20-\\x7E]+",
      },
    ],
    ["Action", "action", { required: true }],
    [
      "SubType",
      "subType",
      {
        required: false,
        minLength: 1,
        maxLength: 32,
        pattern: "[a-zA-Z0-9-_]+",
      },
    ],
    ["Id", "id", { ...OPERATION_ID, required: true }],
  ];

/** The service lists at most this many errors, and counts only those. */
const MAX_REPORTED_ERRORS = 10;

function memberErrors(
  value: unknown,
  path: string,
  constraint: StringConstraint,
): string[] {
  if (value == null) {
    return constraint.required
      ? [
          `Value null at '${path}' failed to satisfy constraint: Member must not be null`,
        ]
      : [];
  }
  if (typeof value !== "string") {
    return [];
  }

  const at = `Value '${value}' at '${path}' failed to satisfy constraint:`;
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

/**
 * Validates every update against the constraints of the service model.
 *
 * The service checks the request against its model before it applies any
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
 * @throws {LambdaServiceException} A `ValidationException` with HTTP status
 * 400, when any member is invalid
 */
export function validateUpdateModel(updates: OperationUpdate[]): void {
  const errors: string[] = [];
  updates.forEach((update, index) => {
    for (const [member, wireName, constraint] of CONSTRAINED_MEMBERS) {
      errors.push(
        ...memberErrors(
          update[member],
          `updates.${index + 1}.member.${wireName}`,
          constraint,
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
