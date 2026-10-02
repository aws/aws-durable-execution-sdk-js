// Structural view of the SDK-owned optional hook contract. Keeping these
// declarations local avoids importing newly added core type names into the
// public OTel .d.ts files consumed with older supported cores. The plugin's
// implements clause checks compatibility with the canonical SDK contract.
export interface PropagationInput {
  readonly executionArn: string;
  readonly operationId: string;
  readonly parentOperationId?: string;
  readonly targetFunctionName: string;
}

export interface PropagationMetadata {
  readonly xAmznTraceId?: string;
}

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
