import type { InsightExporter, WorkflowInsightRecord } from "../types";

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

  constructor(config: HttpExporterConfig) {
    this.url = config.url;
    this.method = config.method ?? "POST";
    this.headers = config.headers ?? {};
    this.timeoutMs = config.timeoutMs ?? 10_000;
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
        body: JSON.stringify(record),
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
