import type {
  InsightExporter,
  OperationsFormat,
  WorkflowInsightRecord,
} from "../types";
import { applyOperationsFormat } from "../operations-index";

/**
 * Configuration for the HTTP/Webhook exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface HttpExporterConfig {
  /** URL to POST records to. */
  url: string;

  /** Additional headers (e.g. authorization tokens, API keys). */
  headers?: Record<string, string>;

  /**
   * HTTP method. Default: "POST".
   * Use "PUT" for endpoints that upsert by URL path.
   */
  method?: "POST" | "PUT";

  /** Request timeout in milliseconds. Default: 10000 (10s). */
  timeoutMs?: number;

  /**
   * How operations are rendered in the posted record: the canonical
   * `operations` array (`"array"`, default), the name-keyed `operationsByName`
   * map (`"by-name"`), or `"both"`. Choose based on what your endpoint consumes.
   */
  operationsFormat?: OperationsFormat;

  /**
   * Max serialized record size before truncation. No default — a generic HTTP
   * endpoint has no known limit; set this if your endpoint caps request size.
   */
  maxRecordSizeBytes?: number;
}

/**
 * Exports workflow insight records to any HTTP endpoint via POST (or PUT).
 *
 * Each record is sent as a JSON body with Content-Type: application/json.
 * The endpoint should return 2xx on success; any other status throws.
 *
 * Uses native fetch (Node 22+ / Lambda runtime) — no dependencies required.
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class HttpExporter implements InsightExporter {
  private readonly url: string;
  private readonly method: "POST" | "PUT";
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly operationsFormat: OperationsFormat;
  readonly maxRecordSizeBytes?: number;

  constructor(config: HttpExporterConfig) {
    this.url = config.url;
    this.method = config.method ?? "POST";
    this.headers = config.headers ?? {};
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRecordSizeBytes = config.maxRecordSizeBytes;
    this.operationsFormat = config.operationsFormat ?? "array";
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.url, {
        method: this.method,
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(
          applyOperationsFormat(record, this.operationsFormat),
        ),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `HttpExporter: endpoint returned ${response.status} ${response.statusText}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single HTTP request.
  }
}
