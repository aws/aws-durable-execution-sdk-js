import type { OperationInfo } from "@aws/durable-execution-sdk-js";
import { type Span, SpanStatusCode } from "@opentelemetry/api";

/** Failure status remains observable even when no exception details exist. */
export function setOperationSpanStatus(
  span: Span,
  info: Pick<OperationInfo, "status" | "error">,
): void {
  if (
    info.error ||
    info.status === "FAILED" ||
    info.status === "TIMED_OUT" ||
    info.status === "STOPPED"
  ) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: info.error?.message ?? info.status,
    });
  } else if (info.status === "SUCCEEDED") {
    span.setStatus({ code: SpanStatusCode.OK });
  }
}
