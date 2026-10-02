import type {
  PropagationInput,
  PropagationMetadata,
} from "@aws/durable-execution-sdk-js";
import { isValidTraceId, isValidSpanId } from "./context-extractors";
import { deriveSpanIdFromOperationId } from "./deterministic-id-generator";

/** Encodes the already resolved execution state without creating a span. */
export function createPropagationMetadata(
  input: PropagationInput,
  executionArn: string,
  traceId: string,
  traceFlags: number,
): PropagationMetadata | undefined {
  if (input.executionArn !== executionArn || !isValidTraceId(traceId))
    return undefined;
  const spanId = deriveSpanIdFromOperationId(input.operationId, executionArn);
  if (!isValidSpanId(spanId)) return undefined;
  return Object.freeze({
    xAmznTraceId: `Root=1-${traceId.slice(0, 8)}-${traceId.slice(8)};Parent=${spanId};Sampled=${traceFlags & 1 ? "1" : "0"}`,
  });
}
