import { XRayClient, BatchGetTracesCommand } from "@aws-sdk/client-xray";

export interface XRaySegment {
  id: string;
  name: string;
  trace_id: string;
  parent_id?: string;
  annotations?: Record<string, string | number | boolean>;
  metadata?: Record<string, Record<string, unknown>>;
  subsegments?: XRaySegment[];
}

export interface XRayTrace {
  traceId: string;
  segments: XRaySegment[];
}

export interface FetchTraceOptions {
  /** Initial delay before fetching the trace (ms). Default: 10000 */
  delayMs?: number;
}

const VALID_OTEL_TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Converts a 32-char lowercase hex OTel trace ID to X-Ray format.
 * Format: 1-{first 8 hex chars}-{remaining 24 hex chars}
 *
 * @param otelTraceId - A 32-character lowercase hex string
 * @returns X-Ray formatted trace ID (36 characters total)
 * @throws Error if input is not a valid 32-char lowercase hex string
 */
export function convertToXRayTraceId(otelTraceId: string): string {
  if (
    otelTraceId == null ||
    typeof otelTraceId !== "string" ||
    !VALID_OTEL_TRACE_ID_PATTERN.test(otelTraceId)
  ) {
    const displayValue =
      otelTraceId == null ? typeof otelTraceId : JSON.stringify(otelTraceId);
    throw new Error(
      `Invalid OTel trace ID: ${displayValue}. Expected a 32-character lowercase hex string matching /^[0-9a-f]{32}$/.`,
    );
  }

  const epochPart = otelTraceId.substring(0, 8);
  const uniquePart = otelTraceId.substring(8);

  return `1-${epochPart}-${uniquePart}`;
}

/**
 * Recursively flattens subsegments from a parsed X-Ray segment document
 * into a flat array of XRaySegment objects.
 */
function flattenSegments(segment: XRaySegment): XRaySegment[] {
  const result: XRaySegment[] = [segment];
  if (segment.subsegments && segment.subsegments.length > 0) {
    for (const subsegment of segment.subsegments) {
      console.debug(subsegment);
      result.push(...flattenSegments(subsegment));
    }
  }
  return result;
}

/**
 * Fetches an X-Ray trace by OTel trace ID.
 *
 * Waits for an initial delay (to allow X-Ray indexing), then calls
 * BatchGetTraces once to retrieve the full trace.
 *
 * @param client - An XRayClient instance
 * @param otelTraceId - A 32-character lowercase hex OTel trace ID
 * @param options - Configuration options
 * @returns The fetched XRayTrace with flattened segments
 * @throws Error if trace not found, access denied, or invalid input
 */
export async function fetchXRayTrace(
  client: XRayClient,
  otelTraceId: string,
  options?: FetchTraceOptions,
): Promise<XRayTrace> {
  const xrayTraceId = convertToXRayTraceId(otelTraceId);
  const delayMs = options?.delayMs ?? 10000;

  // Wait for X-Ray to index the trace
  if (delayMs > 0) {
    console.debug(
      `[xray-trace-helper] Waiting ${delayMs}ms for X-Ray indexing...`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const batchResponse = await client.send(
    new BatchGetTracesCommand({
      TraceIds: [xrayTraceId],
    }),
  );

  const traces = batchResponse.Traces ?? [];
  if (traces.length === 0) {
    throw new Error(
      `X-Ray trace ${xrayTraceId} not found. It may not have been indexed yet.`,
    );
  }

  const traceData = traces[0];
  const segments: XRaySegment[] = [];

  for (const seg of traceData.Segments ?? []) {
    if (seg.Document) {
      const parsed = JSON.parse(seg.Document) as XRaySegment;
      console.log(seg.Document);
      console.log(parsed);
      segments.push(...flattenSegments(parsed));
    }
  }

  console.debug(
    `[xray-trace-helper] Fetched ${traceData.Segments?.length ?? 0} documents, ${segments.length} segments (flattened). Names: [${segments.map((s) => s.name).join(", ")}]`,
  );

  return {
    traceId: xrayTraceId,
    segments,
  };
}

/**
 * Asserts that all expected span names exist in the trace segments.
 * @throws Error listing any missing span names and the actual span names found
 */
export function assertSpanNames(
  trace: XRayTrace,
  expectedNames: string[],
): void {
  const actualNames = trace.segments.map((seg) => seg.name);
  const missingNames = expectedNames.filter(
    (name) => !actualNames.includes(name),
  );

  if (missingNames.length > 0) {
    throw new Error(
      `Missing span names in X-Ray trace: [${missingNames.join(", ")}]. Found spans: [${actualNames.join(", ")}]`,
    );
  }
}

/**
 * Asserts parent-child hierarchy matches expected structure.
 * For each parent→children mapping, verifies the child segment's parent_id
 * matches the parent segment's id.
 *
 * @param trace - The X-Ray trace with flattened segments
 * @param hierarchy - Object mapping parent span names to arrays of child span names
 * @throws Error describing mismatched relationships
 */
export function assertSpanHierarchy(
  trace: XRayTrace,
  hierarchy: Record<string, string[]>,
): void {
  for (const [parentName, childNames] of Object.entries(hierarchy)) {
    const parentSegment = trace.segments.find((seg) => seg.name === parentName);
    if (!parentSegment) {
      throw new Error(
        `Parent span "${parentName}" not found in trace. Available spans: [${trace.segments.map((s) => s.name).join(", ")}]`,
      );
    }

    for (const childName of childNames) {
      const childSegment = trace.segments.find((seg) => seg.name === childName);
      if (!childSegment) {
        throw new Error(
          `Child span "${childName}" (expected child of "${parentName}") not found in trace. Available spans: [${trace.segments.map((s) => s.name).join(", ")}]`,
        );
      }

      if (childSegment.parent_id !== parentSegment.id) {
        throw new Error(
          `Hierarchy mismatch: span "${childName}" has parent_id "${childSegment.parent_id}" but expected parent "${parentName}" has id "${parentSegment.id}"`,
        );
      }
    }
  }
}

/**
 * Asserts a span contains expected attributes in its annotations or metadata.
 * Checks annotations first, then searches all metadata namespaces.
 *
 * @param trace - The X-Ray trace with flattened segments
 * @param spanName - The name of the span to check
 * @param expectedAttributes - Key-value pairs to verify
 * @throws Error describing attribute mismatches
 */
export function assertSpanAttributes(
  trace: XRayTrace,
  spanName: string,
  expectedAttributes: Record<string, unknown>,
): void {
  const segment = trace.segments.find((seg) => seg.name === spanName);
  if (!segment) {
    throw new Error(
      `Span "${spanName}" not found in trace. Available spans: [${trace.segments.map((s) => s.name).join(", ")}]`,
    );
  }

  const mismatches: string[] = [];

  for (const [key, expectedValue] of Object.entries(expectedAttributes)) {
    // Check annotations first
    if (
      segment.annotations &&
      key in segment.annotations &&
      segment.annotations[key] === expectedValue
    ) {
      continue;
    }

    // Check metadata (nested: metadata[namespace][key])
    let foundInMetadata = false;
    if (segment.metadata) {
      for (const namespace of Object.keys(segment.metadata)) {
        const namespaceData = segment.metadata[namespace];
        if (key in namespaceData) {
          const actualValue = namespaceData[key];
          if (JSON.stringify(actualValue) === JSON.stringify(expectedValue)) {
            foundInMetadata = true;
            break;
          } else {
            mismatches.push(
              `Attribute "${key}" on span "${spanName}": expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
            );
            foundInMetadata = true; // Found but mismatched
            break;
          }
        }
      }
    }

    if (!foundInMetadata) {
      // Check if it was in annotations but with wrong value
      if (segment.annotations && key in segment.annotations) {
        mismatches.push(
          `Attribute "${key}" on span "${spanName}": expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(segment.annotations[key])}`,
        );
      } else {
        mismatches.push(
          `Attribute "${key}" not found on span "${spanName}" in annotations or metadata`,
        );
      }
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Attribute assertion failed for span "${spanName}":\n${mismatches.join("\n")}`,
    );
  }
}
