import { Sha256 } from "@aws-crypto/sha256-js";
import { SignatureV4 } from "@smithy/signature-v4";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import type { InsightExporter, WorkflowInsightRecord } from "../types";

/**
 * Configuration for the OpenSearch exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface OpenSearchExporterConfig {
  /** OpenSearch domain endpoint (e.g. "https://my-domain.us-east-1.es.amazonaws.com"). */
  endpoint: string;

  /** Index name. Default: "workflow-insight" */
  indexName?: string;

  /** AWS region. Required for SigV4 signing. */
  region: string;

  /**
   * Authentication method.
   * - "sigv4": IAM-based (default, for Amazon OpenSearch Service)
   * - "basic": username/password (for self-managed or OpenSearch Serverless with basic auth)
   */
  auth?: "sigv4" | "basic";

  /** Username for basic auth. Required if auth is "basic". */
  username?: string;

  /** Password for basic auth. Required if auth is "basic". */
  password?: string;

  /**
   * Max serialized record size before truncation.
   * Default: 10_000_000 (a generous guard; OpenSearch accepts large documents).
   */
  maxRecordSizeBytes?: number;
}

/**
 * Exports workflow insight records to Amazon OpenSearch Service.
 *
 * Uses the Index API with executionArn as the document _id, so subsequent
 * exports for the same execution overwrite the document (upsert).
 *
 * Supports IAM (SigV4) and basic authentication. Uses native fetch — no
 * OpenSearch client library required.
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class OpenSearchExporter implements InsightExporter {
  private readonly endpoint: string;
  private readonly indexName: string;
  private readonly region: string;
  private readonly auth: "sigv4" | "basic";
  private readonly username?: string;
  private readonly password?: string;
  readonly maxRecordSizeBytes: number;

  constructor(config: OpenSearchExporterConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, "");
    this.indexName = config.indexName ?? "workflow-insight";
    this.region = config.region;
    this.auth = config.auth ?? "sigv4";
    this.username = config.username;
    this.password = config.password;
    this.maxRecordSizeBytes = config.maxRecordSizeBytes ?? 10_000_000;
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    const docId = encodeURIComponent(record.executionArn);
    const url = `${this.endpoint}/${this.indexName}/_doc/${docId}`;
    const body = JSON.stringify(record);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.auth === "basic") {
      headers["Authorization"] =
        "Basic " + btoa(`${this.username}:${this.password}`);
    }

    let fetchUrl = url;
    let fetchHeaders = headers;

    if (this.auth === "sigv4") {
      const signed = await this.signRequest(url, body);
      fetchHeaders = { ...headers, ...signed.headers };
      fetchUrl = signed.url;
    }

    const response = await fetch(fetchUrl, {
      method: "PUT",
      headers: fetchHeaders,
      body,
    });

    if (!response.ok && response.status !== 201 && response.status !== 200) {
      throw new Error(
        `OpenSearch index failed: ${response.status} ${response.statusText}`,
      );
    }
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single index request.
  }

  private async signRequest(
    url: string,
    body: string,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const signer = new SignatureV4({
      service: "es",
      region: this.region,
      credentials: defaultProvider(),
      sha256: Sha256,
    });

    const parsedUrl = new URL(url);

    const signed = await signer.sign({
      method: "PUT",
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
      path: parsedUrl.pathname,
      headers: {
        host: parsedUrl.host,
        "content-type": "application/json",
      },
      body,
    });

    return {
      url,
      headers: signed.headers as Record<string, string>,
    };
  }
}
