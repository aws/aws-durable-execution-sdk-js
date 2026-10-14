import { InvalidParameterValueException } from "@aws-sdk/client-lambda";

/**
 * Creates the error that the service returns when a checkpoint fails its
 * validation.
 *
 * The service returns `InvalidParameterValueException` with HTTP status 400.
 * The SDK reads the status to classify a checkpoint failure. A 4xx fails the
 * execution. An error without a status fails only the invocation. So the
 * error carries the status, and a local execution fails as it does in AWS.
 *
 * @param message - The service's message for the failed check
 */
export function invalidParameterValue(
  message: string,
): InvalidParameterValueException {
  return new InvalidParameterValueException({
    message,
    $metadata: { httpStatusCode: 400 },
  });
}
