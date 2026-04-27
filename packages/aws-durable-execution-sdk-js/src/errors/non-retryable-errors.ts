// KMS errors from Lambda that indicate customer-caused key misconfiguration.
// These arrive as 502 errors but are non-retryable.
const NON_RETRYABLE_CUSTOMER_ERRORS = new Set([
  "KMSAccessDeniedException",
  "KMSDisabledException",
  "KMSInvalidStateException",
  "KMSNotFoundException",
]);

/**
 * Returns true if the error is a non-retryable customer error (e.g., KMS key misconfiguration).
 */
export function isNonRetryableCustomerError(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return !!name && NON_RETRYABLE_CUSTOMER_ERRORS.has(name);
}
