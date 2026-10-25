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
    // A record that was terminal at the start was emitted by an earlier invocation.
    // The exception is a record in updatedOperationIds: the service ended it between
    // the invocations, for example a wait. No earlier invocation saw it end.
    const updated = new Set(info.updatedOperationIds);
    const emittedBefore = new Set(
      info.operations
        .filter((r) => TERMINAL.has(r.Status) && !updated.has(r.Id))
        .map((r) => r.Id),
    );
    const first = info.operations.every((r) => r.Type === "EXECUTION");
    const attemptSpans = [];

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
        attemptSpans.push(
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

    return {
      wrap(w) {
        if (w.kind === "attempt") return attempt(w);
        if (w.kind === "context")
          return runIn(operationSpanId(arn, w.id), w.fn);
        return runIn(invocationId, w.fn);
      },

      async onInvocationEnd({ status, error, operations }) {
        const endMs = Date.now();
        const spans = operations
          .filter(
            (r) =>
              r.Type !== "EXECUTION" &&
              TERMINAL.has(r.Status) &&
              !emittedBefore.has(r.Id),
          )
          .map(operationSpan);
        spans.push(...attemptSpans);
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
        await exportSpans(exporter, spans, exportTimeoutMs);
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
