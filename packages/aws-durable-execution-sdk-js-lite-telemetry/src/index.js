import { createHash } from "node:crypto";
import { buildRecord, executionStartMs } from "./record.js";
import { fitRecord } from "./truncate.js";

export { buildRecord } from "./record.js";

// Every warning is one line with this prefix. Telemetry must not fail the workflow. So
// the plugin reports its own failures in the function's log and continues.
function warn(message) {
  // biome-ignore lint/suspicious/noConsole: deliberate -- the function's log is the only place to report a lost record.
  console.warn(`[durable-execution-telemetry] ${message}`);
}

// Which invocation end statuses produce a record, per emit mode.
const EMITS_AT_END = {
  "on-complete": (status) => status === "SUCCEEDED" || status === "FAILED",
  "on-failure": (status) => status === "FAILED",
  "on-change": () => true,
};

// The lite SDK calls the returned factory once per invocation. So the factory's closure
// holds what all invocations share: the exporters and the options. Each call keeps its
// own state in local variables (README of the lite SDK, "Keep plugin state on the
// plugin object").
export function createTelemetryPlugin({
  exporters,
  emitMode = "on-complete",
  operations = "top-level",
  includeInput = true,
  includeOutput = true,
  samplingRate = 1,
  exportTimeoutMs = 3000,
}) {
  const emitsAtEnd = EMITS_AT_END[emitMode];
  return (info) => {
    if (!isSampled(info.arn, samplingRate)) return undefined;
    const startTime = new Date(executionStartMs(info.operations));
    const input = includeInput ? info.input : undefined;
    let lastEmittedMs = 0;
    // The exports of this invocation, chained. Each export starts after the previous
    // one settled. So an exporter that upserts never replaces a newer record of this
    // invocation with an older one.
    let exports = Promise.resolve();

    // Telemetry must not change the workflow. A throw from onOperationChange would end
    // the invocation. So emit catches its own errors.
    const emit = (status, records, output, error) => {
      try {
        // emittedAt strictly increases within the invocation. Two records can be built
        // in the same millisecond. The Aurora exporter keeps the row with the larger
        // emittedAt. With equal values, the older record could replace the newer one.
        const now = Date.now();
        lastEmittedMs = now > lastEmittedMs ? now : lastEmittedMs + 1;
        const record = buildRecord({
          arn: info.arn,
          status,
          operations: records,
          input,
          output,
          error,
          startTime,
          emittedAt: new Date(lastEmittedMs),
          operationsMode: operations,
        });
        exports = exports.then(() =>
          Promise.all(exporters.map((exporter) => exportTo(exporter, record))),
        );
      } catch (err) {
        warn(`could not build the record: ${describe(err)}`);
      }
    };

    if (emitMode === "on-change") emit("RUNNING", info.operations);
    return {
      // The SDK does not await onOperationChange. So the export only starts here.
      // onInvocationEnd awaits it.
      onOperationChange:
        emitMode === "on-change"
          ? (change) => emit("RUNNING", change.operations)
          : undefined,
      async onInvocationEnd({ status, result, error, operations: records }) {
        if (emitsAtEnd(status)) {
          emit(
            status,
            records,
            includeOutput && status === "SUCCEEDED" ? result : undefined,
            status === "FAILED" ? error : undefined,
          );
        }
        await settleWithin(exports, exportTimeoutMs);
      },
    };
  };
}

// The decision depends only on the ARN. So every invocation of one execution makes the
// same decision, and an execution has all of its records or none. The first 8 hex
// digits of the SHA-256 hash give a fraction in [0, 1).
function isSampled(arn, rate) {
  const hash = createHash("sha256").update(arn).digest("hex");
  return Number.parseInt(hash.slice(0, 8), 16) / 0x1_0000_0000 < rate;
}

// Never rejects. A failed export loses one record. It must not fail the invocation.
async function exportTo(exporter, record) {
  try {
    const fitted = fitRecord(record, exporter.maxRecordBytes);
    if (!fitted) {
      warn(
        `the record is larger than ${exporter.maxRecordBytes} bytes after truncation. It was not exported.`,
      );
      return;
    }
    await exporter.export(fitted);
  } catch (err) {
    warn(`export failed: ${describe(err)}`);
  }
}

// The handler returns only after onInvocationEnd settles, and Lambda bills that time.
// So the wait for the exports ends after ms. An export that is still running then
// continues in the background. Lambda can freeze it with the sandbox.
async function settleWithin(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      warn(`exports did not finish within ${ms} ms.`);
      resolve();
    }, ms);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// One line, without the stack.
const describe = (err) => `${err?.name ?? "Error"}: ${err?.message ?? err}`;
