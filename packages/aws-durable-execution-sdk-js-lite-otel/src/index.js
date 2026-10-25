import { context, trace } from "@opentelemetry/api";
import { exportSpans } from "./export.js";
import {
  attemptSpanId,
  invocationSpanId,
  isSampled,
  operationSpanId,
  traceId as traceIdOf,
  workflowSpanId,
} from "./ids.js";
import {
  buildSpan,
  plainResource,
  recordError,
  recordMs,
  spanContext,
  TERMINAL,
} from "./spans.js";

// The operation types whose records the service ends. The SDK ends STEP and CONTEXT.
const SERVICE_ENDED = new Set(["WAIT", "CALLBACK", "CHAINED_INVOKE"]);

// The exporter and the resource are shared by every invocation. They live in this
// closure. The state of one invocation lives in the closure of one factory call. Lambda
// Managed Instances can run several invocations in one process at the same time. So no
// per-invocation state is kept at module level.
export function createOtelPlugin({
  exporter,
  resource,
  serviceName,
  sampleRate = 1,
  exportTimeoutMs = 3000,
  flushIntervalMs = 5000,
}) {
  const res =
    resource ??
    plainResource({
      "service.name":
        serviceName ??
        process.env.AWS_LAMBDA_FUNCTION_NAME ??
        "durable-function",
      "cloud.provider": "aws",
      "cloud.region": process.env.AWS_REGION,
      "faas.name": process.env.AWS_LAMBDA_FUNCTION_NAME,
    });

  return (info) => {
    const { arn, requestId } = info;
    const traceId = traceIdOf(arn);
    // Not sampled: no plugin, so the SDK calls no hook in this invocation.
    if (!isSampled(traceId, sampleRate)) return undefined;

    const startMs = Date.now();
    const workflowId = workflowSpanId(arn);
    const invocationId = invocationSpanId(arn, requestId);
    // emitted holds the Ids of the records whose operation span was already built.
    // 1. A record that was terminal at the start was emitted by an earlier invocation.
    // 2. The exception is a wait, a callback or an invoke in updatedOperationIds. The
    //    service ends these records, and it can end one between two invocations. Then no
    //    earlier invocation saw it end.
    // 3. Only the SDK ends a STEP or a CONTEXT record. So an earlier invocation saw it end.
    //    After an invocation that timed out, the service lists every record that the
    //    invocation changed in updatedOperationIds. The interval flush already sent most
    //    of their spans. So a STEP or a CONTEXT in updatedOperationIds is not built again.
    //    A span that finished in the last interval before a crash is lost.
    const updated = new Set(info.updatedOperationIds);
    const endedByService = (r) =>
      SERVICE_ENDED.has(r.Type) && updated.has(r.Id);
    const emitted = new Set(
      info.operations
        .filter((r) => TERMINAL.has(r.Status) && !endedByService(r))
        .map((r) => r.Id),
    );
    const first = info.operations.every((r) => r.Type === "EXECUTION");

    // Finished spans that no export has taken yet. A flush sends them during the
    // invocation, like the BatchSpanProcessor of OpenTelemetry. So a crash or a timeout
    // loses only the spans of the last interval.
    let buffer = [];
    let timer;
    let lastExportMs = startMs;
    let ended = false;
    // Each export starts after the previous one settles. exportSpans never rejects. So
    // the chain never rejects, and onInvocationEnd awaits every export.
    let exports = Promise.resolve();
    // The number of exports that have not settled yet.
    let pending = 0;

    const flush = () => {
      timer = undefined;
      const batch = buffer;
      buffer = [];
      lastExportMs = Date.now();
      if (batch.length > 0) {
        pending++;
        exports = exports
          .then(() => exportSpans(exporter, batch, exportTimeoutMs))
          .then(() => {
            pending--;
          });
      }
    };

    // A long step can run for minutes without a checkpoint response. So a timer sends
    // the buffer, not only the next onOperationChange. The timer is unref'd, so it never
    // keeps a process alive. After onInvocationEnd started, a span is dropped, because
    // no hook would await its export.
    const add = (span) => {
      if (ended) return;
      buffer.push(span);
      if (flushIntervalMs > 0 && timer === undefined) {
        timer = setTimeout(
          flush,
          Math.max(0, flushIntervalMs - (Date.now() - lastExportMs)),
        );
        timer.unref?.();
      }
    };

    // An operation span is built once, when its record is terminal for the first time.
    // Then emitted holds its Id. So no operation span is exported twice.
    const isNew = (r) =>
      r.Type !== "EXECUTION" && TERMINAL.has(r.Status) && !emitted.has(r.Id);

    // The parent of a record's span is the span of its ParentId. A record without
    // ParentId is a child of the workflow span.
    const parentOf = (parentId) =>
      parentId === undefined ? workflowId : operationSpanId(arn, parentId);

    // context.with makes the span the active span while fn runs. So spans that user
    // code creates become its children. Without a registered context manager,
    // context.with only calls fn.
    const runIn = (spanId, fn) =>
      context.with(
        trace.setSpanContext(context.active(), spanContext(traceId, spanId)),
        fn,
      );

    const attempt = ({ id, name, type, subType, attempt: n, fn }) => {
      const attemptStart = Date.now();
      const spanId = attemptSpanId(arn, id, n);
      // ok is false when fn threw or its promise rejected. thrown is then the reason.
      const finish = (ok, thrown) =>
        add(
          buildSpan({
            traceId,
            spanId,
            parentSpanId: operationSpanId(arn, id),
            name: `${name ?? type} attempt ${n}`,
            startMs: attemptStart,
            endMs: Date.now(),
            ok,
            error: ok
              ? undefined
              : {
                  ErrorType: thrown?.name ?? "Error",
                  ErrorMessage: thrown?.message ?? String(thrown),
                },
            attributes: {
              "durable.execution.arn": arn,
              "durable.operation.id": id,
              "durable.operation.type": type,
              "durable.operation.name": name,
              "durable.operation.subtype": subType,
              "durable.attempt.number": n,
            },
            resource: res,
          }),
        );
      let out;
      try {
        out = runIn(spanId, fn);
      } catch (error) {
        finish(false, error);
        throw error;
      }
      // The SDK awaits the returned value. So the original promise is returned, and
      // the handlers only record the span. The derived promise always fulfills.
      if (typeof out?.then === "function") {
        out.then(
          () => finish(true),
          (error) => finish(false, error),
        );
      } else {
        finish(true);
      }
      return out;
    };

    // The handler returns only after this function settles. Without an earlier export
    // that still runs, the final export starts at once and bounds itself. Else the final
    // export starts only after the earlier exports. So the total wait is bounded too:
    // 1. The deadline is exportTimeoutMs after the end of the invocation.
    // 2. The final export gets the time left until the deadline. So once it starts, it
    //    settles by the deadline, and its own timeout logs a failure.
    // 3. If earlier exports still run at the deadline, the final export never starts.
    //    Its spans are lost. One line is logged.
    const finalExport = async (spans) => {
      if (pending === 0) return exportSpans(exporter, spans, exportTimeoutMs);
      const deadline = Date.now() + exportTimeoutMs;
      let late;
      let lateTimer;
      const lateTimeout = new Promise((resolve) => {
        lateTimer = setTimeout(() => {
          late = true;
          resolve();
        }, exportTimeoutMs);
      });
      const done = exports.then(() => {
        if (late) return;
        clearTimeout(lateTimer);
        return exportSpans(exporter, spans, Math.max(0, deadline - Date.now()));
      });
      await Promise.race([done, lateTimeout]);
      if (late) {
        // biome-ignore lint/suspicious/noConsole: deliberate -- a lost export must be visible, and Lambda sends console output to CloudWatch.
        console.warn(
          `durable-execution-sdk-js-lite-otel: trace export failed: timed out after ${exportTimeoutMs} ms`,
        );
      }
    };

    const operationSpan = (r) =>
      buildSpan({
        traceId,
        spanId: operationSpanId(arn, r.Id),
        parentSpanId: parentOf(r.ParentId),
        name: r.Name ?? r.Type,
        startMs: recordMs(r.StartTimestamp ?? r.EndTimestamp ?? Date.now()),
        endMs:
          r.EndTimestamp === undefined ? Date.now() : recordMs(r.EndTimestamp),
        ok: r.Status === "SUCCEEDED",
        statusMessage: r.Status,
        error: recordError(r),
        attributes: {
          "durable.execution.arn": arn,
          "durable.operation.id": r.Id,
          "durable.operation.type": r.Type,
          "durable.operation.name": r.Name,
          "durable.operation.subtype": r.SubType,
          "durable.operation.status": r.Status,
          "durable.attempt.number":
            r.Type === "STEP" ? r.StepDetails?.Attempt : undefined,
        },
        resource: res,
      });

    // Builds the span of every record that became terminal in this checkpoint response.
    // With flushIntervalMs 0, the plugin has no onOperationChange. So every operation
    // span is built at the end of the invocation.
    const onOperationChange = ({ updated }) => {
      for (const r of updated) {
        if (!isNew(r)) continue;
        emitted.add(r.Id);
        add(operationSpan(r));
      }
    };

    return {
      onOperationChange: flushIntervalMs > 0 ? onOperationChange : undefined,

      wrap(w) {
        if (w.kind === "attempt") return attempt(w);
        if (w.kind === "context")
          return runIn(operationSpanId(arn, w.id), w.fn);
        return runIn(invocationId, w.fn);
      },

      async onInvocationEnd({ status, error, operations }) {
        const endMs = Date.now();
        ended = true;
        clearTimeout(timer);
        const spans = operations.filter(isNew).map(operationSpan);
        spans.push(...buffer);
        buffer = [];
        spans.push(
          buildSpan({
            traceId,
            spanId: invocationId,
            parentSpanId: workflowId,
            name: "Invocation",
            startMs,
            endMs,
            ok: status === "SUCCEEDED" || status === "PENDING",
            statusMessage: status,
            attributes: {
              "durable.execution.arn": arn,
              "faas.invocation_id": requestId,
              "durable.invocation.status": status,
              "durable.invocation.first": first,
            },
            resource: res,
          }),
        );
        // Only the invocation that ends the execution knows the workflow's end.
        if (status === "SUCCEEDED" || status === "FAILED") {
          const execution = operations.find((r) => r.Type === "EXECUTION");
          spans.push(
            buildSpan({
              traceId,
              spanId: workflowId,
              name: workflowName(arn),
              startMs:
                execution?.StartTimestamp === undefined
                  ? startMs
                  : recordMs(execution.StartTimestamp),
              endMs,
              ok: status === "SUCCEEDED",
              statusMessage: status,
              // For FAILED, error is the ErrorObject that the handler returns.
              error,
              attributes: {
                "durable.execution.arn": arn,
                "durable.execution.status": status,
              },
              resource: res,
            }),
          );
        }
        await finalExport(spans);
      },
    };
  };
}

// The ARN has the form
// arn:aws:lambda:REGION:ACCOUNT:function:NAME:QUALIFIER/durable-execution/EXEC/ID.
// So the function name is the 7th field of the part before the first "/".
function workflowName(arn) {
  return arn.split("/")[0].split(":")[6] || "Workflow";
}
