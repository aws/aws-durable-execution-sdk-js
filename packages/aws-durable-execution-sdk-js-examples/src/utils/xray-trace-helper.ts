import { XRayClient, BatchGetTracesCommand } from "@aws-sdk/client-xray";

/**
 * Parse the _X_AMZN_TRACE_ID header to extract the OTel trace ID,
 * using the same logic as xRayContextExtractor.
 *
 * @param header - The raw _X_AMZN_TRACE_ID value, e.g.
 *   "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1"
 * @returns A 32-char lowercase hex trace ID, or undefined if the header is invalid
 */
export function extractTraceIdFromXRayHeader(
  header: string,
): string | undefined {
  const fields = new Map<string, string>();
  for (const part of header.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx > 0) {
      const key = part.slice(0, eqIdx).trim();
      const value = part.slice(eqIdx + 1).trim();
      fields.set(key, value);
    }
  }

  const root = fields.get("Root");
  if (!root) {
    return undefined;
  }

  const rootValue = root.startsWith("1-") ? root.slice(2) : root;
  const traceId = rootValue.replace(/-/g, "").toLowerCase();

  if (!/^[0-9a-f]{32}$/.test(traceId)) {
    return undefined;
  }

  return traceId;
}

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
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const segments: XRaySegment[] = [];
  let nextToken: string | undefined;

  do {
    const batchResponse = await client.send(
      new BatchGetTracesCommand({
        TraceIds: [xrayTraceId],
        NextToken: nextToken,
      }),
    );

    const traces = batchResponse.Traces ?? [];
    if (traces.length === 0 && segments.length === 0) {
      throw new Error(
        `X-Ray trace ${xrayTraceId} not found. It may not have been indexed yet.`,
      );
    }

    for (const traceData of traces) {
      for (const seg of traceData.Segments ?? []) {
        if (seg.Document) {
          const parsed = JSON.parse(seg.Document) as XRaySegment;
          segments.push(...flattenSegments(parsed));
        }
      }
    }

    nextToken = batchResponse.NextToken;
  } while (nextToken);

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
 * For each parent→children mapping, verifies the parent segment contains
 * the expected child in its subsegments array (parent→child direction).
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

    const subsegmentNames = getSubsegmentNames(parentSegment);

    for (const childName of childNames) {
      if (!subsegmentNames.has(childName)) {
        throw new Error(
          `Hierarchy mismatch: expected "${childName}" to be a subsegment of "${parentName}", ` +
            `but "${parentName}" only has subsegments: [${[...subsegmentNames].join(", ")}]`,
        );
      }
    }
  }
}

/**
 * Recursively collects all subsegment names from a segment.
 */
function getSubsegmentNames(segment: XRaySegment): Set<string> {
  const names = new Set<string>();
  if (segment.subsegments) {
    for (const sub of segment.subsegments) {
      names.add(sub.name);
      for (const nested of getSubsegmentNames(sub)) {
        names.add(nested);
      }
    }
  }
  return names;
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
        if (typeof namespaceData !== "object" || namespaceData === null) {
          mismatches.push(`metadata is not an object or is null`);
          continue;
        }
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
