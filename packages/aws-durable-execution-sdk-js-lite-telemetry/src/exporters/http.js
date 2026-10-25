import { applyOperationsFormat } from "../operations-by-name.js";

// Sends each record as one JSON request to any URL, as in the full SDK's HttpExporter.
// The exporter does not retry, as in the full SDK. A failed request loses the record.
export function createHttpExporter({
  url,
  // "POST" or "PUT". PUT suits an endpoint that replaces the resource at the URL.
  method = "POST",
  headers,
  // The full SDK's default.
  timeoutMs = 10_000,
  // "array", "by-name" or "both", as in the full SDK. See applyOperationsFormat.
  operationsFormat = "array",
  // A generic endpoint has no known size limit. So, as in the full SDK, no default.
  maxRecordBytes,
  fetch = globalThis.fetch,
}) {
  return {
    maxRecordBytes,
    async export(record) {
      // The timeout also covers reading the response body. Without it, a slow endpoint
      // keeps the request running after the plugin stops waiting.
      const signal = AbortSignal.timeout(timeoutMs);
      const res = await fetch(url, {
        method,
        // A "Content-Type" key in headers replaces the default, as in the full SDK.
        // fetch joins header names that differ only in case. So "content-type" adds a
        // second value instead.
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(applyOperationsFormat(record, operationsFormat)),
        signal,
      });
      // Node's fetch keeps the connection of a response until its body is read or
      // garbage collected. So the exporter reads the body of every response. The
      // connection then returns to the pool for the next export.
      const text = await res.text();
      if (res.ok) return;
      // The start of the body often names the cause. 200 characters keep the warning
      // line short.
      const err = new Error(
        `HTTP exporter: the endpoint returned ${res.status} ${res.statusText}. Body: ${JSON.stringify(text.slice(0, 200))}`,
      );
      err.status = res.status;
      throw err;
    },
  };
}
