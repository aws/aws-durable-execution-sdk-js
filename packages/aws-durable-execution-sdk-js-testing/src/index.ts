export * from "./test-runner";

// The durable execution protocol shapes come from the SDK, which declares them itself.
// They were previously re-exported straight from `@aws-sdk/client-lambda`; the enum values
// and the operation shapes are identical either way -- the SDK asserts that against the
// service model -- but sourcing them here keeps the AWS SDK out of this package's public
// API and leaves one definition of each rather than two.
//
// `Operation` and `WireOperation` are named because this package's own surface refers to
// them: `DurableLambdaHandler` carries a `DurableExecutionInvocationInput`, whose
// `InitialExecutionState.Operations` is a `WireOperation[]`.
export { OperationStatus, OperationType } from "@aws/durable-execution-sdk-js";
export type { Operation, WireOperation } from "@aws/durable-execution-sdk-js";

// Still AWS SDK concerns: these describe the Lambda invoke and execution-history APIs the
// cloud test runner calls, and have no equivalent in the durable execution protocol.
export { ExecutionStatus, InvocationType } from "@aws-sdk/client-lambda";
