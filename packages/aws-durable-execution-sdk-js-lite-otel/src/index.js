import { exportSpans } from "./export.js";
import {
  attemptSpanId,
  invocationSpanId,
  invokeTraceHeader,
  isSampled,
  operationSpanId,
  parseTraceHeader,
  traceId as traceIdOf,
  workflowSpanId,
} from "./ids.js";
import { contextRunner } from "./otel-context.js";
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

// The time that the handler keeps after the final export, to return its output to Lambda.
// Lambda ends an invocation at its deadline. Then the output is lost, and Lambda invokes
// again. So the final export settles at least this long before the deadline.
const DEADLINE_MARGIN_MS = 500;

// The exporter, the resource and the context runner are shared by every invocation. They
// live in this closure. The state of one invocation lives in the closure of one factory call. Lambda
// Managed Instances can run several invocations in one process at the same time. So no
// per-invocation state is kept at module level.
export function createOtelPlugin({
  exporter,
  resource,
  serviceName,
  sampleRate = 1,
  exportTimeoutMs = 3000,
  flushIntervalMs = 5000,
  otelApi,
}) {
  const runWithSpanContext = contextRunner(otelApi);
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
    const { arn, requestId, lambdaContext } = info;
    // The trace id comes from the Root of the invocation's Lambda trace header:
    // 1. Lambda Managed Instances run invocations of one process at the same time. So
    //    _X_AMZN_TRACE_ID can belong to another invocation. lambdaContext.xRayTraceId
    //    belongs to this one. So the plugin reads the environment only without it.
    // 2. The service gives every invocation of one execution the same Root. So every
    //    invocation computes the same trace id.
    // 3. An execution started by ctx.invoke receives the caller's Root (traceHeader
    //    below). So the caller and the invoked execution share one trace.
    // Without a valid Root, the trace id is a hash of the ARN.
    const header = parseTraceHeader(
      lambdaContext?.xRayTraceId ?? process.env._X_AMZN_TRACE_ID,
    );
    const traceId = header?.traceId ?? traceIdOf(arn);
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

    // The span is the active span while fn runs. So spans that user code creates become
    // its children. Without otelApi and without a registered context manager of
    // @opentelemetry/api 1.x, fn only runs.
    const runIn = (spanId, fn) =>
      runWithSpanContext(spanContext(traceId, spanId), fn);

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

    // The time that the final export may take:
    // 1. A telemetry failure must not fail the invocation. An invocation that reaches
    //    Lambda's deadline fails: Lambda ends it, drops its output and invokes again.
    // 2. lambdaContext.getRemainingTimeInMillis() is the time left until that deadline.
    // 3. The handler still has to return after the export. DEADLINE_MARGIN_MS keeps that
    //    time.
    // 4. So the export gets exportTimeoutMs, but at most the remaining time minus the
    //    margin. Without getRemainingTimeInMillis, for example outside Lambda, it gets
    //    exportTimeoutMs.
    const exportBudget = () => {
      const remaining = lambdaContext?.getRemainingTimeInMillis?.();
      if (typeof remaining !== "number") return exportTimeoutMs;
      return Math.min(exportTimeoutMs, remaining - DEADLINE_MARGIN_MS);
    };

    // The handler returns only after this function settles. Without an earlier export
    // that still runs, the final export starts at once and bounds itself. Else the final
    // export starts only after the earlier exports. So the total wait is bounded too:
    // 1. The budget is exportBudget() when the invocation ends. Without any budget, the
    //    final export is not sent. Its spans are lost. One line is logged.
    // 2. The deadline is the budget after the end of the invocation.
    // 3. The final export gets the time left until the deadline. So once it starts, it
    //    settles by the deadline, and its own timeout logs a failure.
    // 4. If earlier exports still run at the deadline, the final export never starts.
    //    Its spans are lost. One line is logged.
    const finalExport = async (spans) => {
      const budgetMs = exportBudget();
      if (budgetMs <= 0) {
        // biome-ignore lint/suspicious/noConsole: deliberate -- a lost export must be visible, and Lambda sends console output to CloudWatch.
        console.warn(
          `durable-execution-sdk-js-lite-otel: trace export skipped: the invocation ends less than ${DEADLINE_MARGIN_MS} ms before its Lambda timeout`,
        );
        return;
      }
      if (pending === 0) return exportSpans(exporter, spans, budgetMs);
      const deadline = Date.now() + budgetMs;
      let late;
      let lateTimer;
      const lateTimeout = new Promise((resolve) => {
        lateTimer = setTimeout(() => {
          late = true;
          resolve();
        }, budgetMs);
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
          `durable-execution-sdk-js-lite-otel: trace export failed: timed out after ${budgetMs} ms`,
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

      // The invoked execution receives this header. So its spans get this trace id,
      // and its workflow span links to the span of the CHAINED_INVOKE operation.
      traceHeader: ({ id }) =>
        invokeTraceHeader(traceId, operationSpanId(arn, id)),

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
                "durable.trace.header_parent": header?.parent,
              },
              links: invokerLink(traceId, header?.parent),
              resource: res,
            }),
          );
        }
        await finalExport(spans);
      },
    };
  };
}

// The header's Parent is a span id. The workflow span links to it. It does not use it as
// its parent:
// 1. A parent must be a span in the trace. Else the backend shows a broken tree.
// 2. For an execution that ctx.invoke started, in PassThrough tracing, Parent is the
//    caller's CHAINED_INVOKE span. That span exists.
// 3. In Active tracing, Lambda replaces Parent in every invocation with a span of its
//    own. The plugin never exports that span.
// 4. For a top-level execution, Parent is a Lambda span or a span of the upstream caller.
//    The plugin never exports these spans either.
// 5. A link can point to a span that does not exist.
// So the workflow span stays a root span, with a link to Parent. The final invocation
// emits the workflow span, so the link uses that invocation's Parent.
function invokerLink(traceId, parent) {
  if (parent === undefined) return [];
  return [
    {
      context: { traceId, spanId: parent, traceFlags: 1, isRemote: true },
      attributes: { "durable.link": "invoker" },
    },
  ];
}

// The ARN has the form
// arn:aws:lambda:REGION:ACCOUNT:function:NAME:QUALIFIER/durable-execution/EXEC/ID.
// So the function name is the 7th field of the part before the first "/".
function workflowName(arn) {
  return arn.split("/")[0].split(":")[6] || "Workflow";
}
