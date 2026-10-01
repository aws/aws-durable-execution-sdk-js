import { LambdaServiceException } from "@aws-sdk/client-lambda";
import { OperationUpdate } from "@aws/durable-execution-sdk-js";

const MAX_SUB_TYPE_LENGTH = 32;
const SUB_TYPE_PATTERN = "[a-zA-Z0-9-_]+";
const SUB_TYPE_REGEX = new RegExp(`^${SUB_TYPE_PATTERN}$`);

/**
 * Validates the `SubType` of every update, as the service model does.
 *
 * The service checks the request against its model before it applies any
 * update. A subtype must have at most 32 characters, and must match
 * `[a-zA-Z0-9-_]+`. One invalid subtype rejects the whole request with HTTP
 * 400 `ValidationException`. The message lists every failed constraint, and
 * names each update by its 1-based position in `Updates`.
 *
 * The length and pattern messages match the service's. An empty subtype
 * fails the pattern, and the service model requires at least 1 character.
 * Its message follows the same format.
 *
 * @param updates - The updates of one checkpoint request
 * @throws {LambdaServiceException} A `ValidationException` with HTTP status
 * 400, when any subtype is invalid
 */
export function validateSubTypes(updates: OperationUpdate[]): void {
  const errors: string[] = [];
  updates.forEach((update, index) => {
    const subType = update.SubType;
    if (subType === undefined) {
      return;
    }
    const at = `Value '${subType}' at 'updates.${index + 1}.member.subType' failed to satisfy constraint:`;
    if (subType.length === 0) {
      errors.push(`${at} Member must have length greater than or equal to 1`);
      return;
    }
    if (subType.length > MAX_SUB_TYPE_LENGTH) {
      errors.push(
        `${at} Member must have length less than or equal to ${MAX_SUB_TYPE_LENGTH}`,
      );
    }
    if (!SUB_TYPE_REGEX.test(subType)) {
      errors.push(
        `${at} Member must satisfy regular expression pattern: ${SUB_TYPE_PATTERN}`,
      );
    }
  });

  if (errors.length === 0) {
    return;
  }
  const count =
    errors.length === 1
      ? "1 validation error detected"
      : `${errors.length} validation errors detected`;
  throw new LambdaServiceException({
    name: "ValidationException",
    $fault: "client",
    $metadata: { httpStatusCode: 400 },
    message: `${count}: ${errors.join("; ")}`,
  });
}
