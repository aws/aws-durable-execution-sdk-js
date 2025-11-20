// Configure Jest to retry failed tests up to 2 times
// This helps with beta backend issues until we use production for integration tests
jest.retryTimes(2, { logErrorsBeforeRetry: true });
