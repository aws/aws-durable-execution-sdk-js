// Builds a telemetry record from the lite SDK's wire records. The record has the JSON
// shape of DurableExecutionTelemetryRecord in @aws/durable-execution-sdk-js-telemetry-exporter.
// So viewers of that package read these records too.

// A lite invocation status, or "RUNNING", mapped to the record status. A suspended or
// retrying execution has not ended. So PENDING and RETRYING are RUNNING.
const STATUS = { SUCCEEDED: "SUCCEEDED", FAILED: "FAILED" };

// Every detail object that can hold an operation's Error.
const DETAILS = [
  "StepDetails",
  "CallbackDetails",
  "ChainedInvokeDetails",
  "ContextDetails",
];

// A checkpoint response sends epoch seconds as a number. The invocation event sends an
// ISO 8601 string. Returns epoch milliseconds, or undefined for a missing or invalid
// value. Rounding keeps durations whole: 1700000000.123 * 1000 is not an integer.
export function toEpochMs(t) {
  const ms = typeof t === "number" ? Math.round(t * 1000) : Date.parse(t);
  return Number.isFinite(ms) ? ms : undefined;
}

const toIso = (ms) =>
  ms === undefined ? undefined : new Date(ms).toISOString();

// The wire ErrorObject {ErrorType, ErrorMessage} as an ErrorRecord {name, message}. The
// full SDK writes "Error" and "" for a missing name and message.
export function toErrorRecord(error) {
  if (!error) return undefined;
  return {
    name: error.ErrorType ?? "Error",
    message: error.ErrorMessage ?? "",
  };
}

// The ARN format is
// arn:<partition>:lambda:<region>:<account>:function:<name>:<qualifier>/durable-execution/<executionName>/<id>.
// This is the full SDK's parseExecutionArn.
export function parseExecutionArn(arn) {
  const parts = arn.split(":");
  const segments = (parts[7] ?? "").split("/");
  return {
    region: parts[3] ?? "",
    accountId: parts[4] ?? "",
    functionName: parts[6] ?? "",
    qualifier: segments[0] ?? "",
    executionName: segments[2] ?? "",
  };
}

// The start of the execution, not of this invocation: the EXECUTION record's
// StartTimestamp. Without it, the current time.
export function executionStartMs(operations) {
  const execution = operations.find((op) => op.Type === "EXECUTION");
  return toEpochMs(execution?.StartTimestamp) ?? Date.now();
}

export function toOperationRecord(op) {
  const startMs = toEpochMs(op.StartTimestamp);
  const endMs = toEpochMs(op.EndTimestamp);
  const error = DETAILS.map((key) => op[key]?.Error).find(Boolean);
  return {
    id: op.Id,
    name: op.Name,
    type: op.Type,
    subType: op.SubType,
    parentId: op.ParentId,
    status: op.Status ?? "UNKNOWN",
    startTime: toIso(startMs),
    endTime: toIso(endMs),
    durationMs:
      startMs !== undefined && endMs !== undefined
        ? endMs - startMs
        : undefined,
    attempt: op.StepDetails?.Attempt,
    error: toErrorRecord(error),
  };
}

// The full SDK leaves out three kinds of record:
// 1. The EXECUTION record. The record's top level already has its status and times.
// 2. Unnamed operations. A viewer cannot find them by name, and operationsByName
//    cannot key them.
// 3. With "top-level", operations that have a ParentId.
// The full SDK includes an operation's result only on explicit opt-in. This package
// never includes results.
export function buildOperationRecords(operations, mode = "top-level") {
  if (mode === "none") return [];
  const records = [];
  for (const op of operations) {
    if (op.Type === "EXECUTION" || !op.Name) continue;
    if (mode === "top-level" && op.ParentId) continue;
    records.push(toOperationRecord(op));
  }
  return records;
}

export function buildRecord({
  arn,
  status,
  operations = [],
  input,
  output,
  error,
  startTime,
  emittedAt = new Date(),
  operationsMode = "top-level",
}) {
  const parsed = parseExecutionArn(arn);
  const recordStatus = STATUS[status] ?? "RUNNING";
  const startMs = startTime?.getTime() ?? executionStartMs(operations);
  // Only an ended execution has an end time. The record is built when it ends.
  const endMs = recordStatus === "RUNNING" ? undefined : emittedAt.getTime();
  return {
    recordType: "DurableExecutionTelemetry",
    schemaVersion: "1.0",
    emittedAt: emittedAt.toISOString(),
    executionArn: arn,
    executionName: parsed.executionName || undefined,
    functionName: parsed.functionName,
    functionQualifier: parsed.qualifier,
    region: parsed.region,
    accountId: parsed.accountId,
    status: recordStatus,
    startTime: new Date(startMs).toISOString(),
    endTime: toIso(endMs),
    durationMs: endMs === undefined ? undefined : endMs - startMs,
    input,
    output,
    error: toErrorRecord(error),
    operations: buildOperationRecords(operations, operationsMode),
  };
}
