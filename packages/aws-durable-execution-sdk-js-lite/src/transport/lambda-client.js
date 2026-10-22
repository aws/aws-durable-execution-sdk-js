import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { VERSION } from "../version.js";
import { encodeRfc3986, signRequest } from "./sigv4.js";

const API = "/2025-12-01/durable-executions";
const MAX_ATTEMPTS = 3;

export function createLambdaClient({
  region = process.env.AWS_REGION,
  credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  },
  endpoint = process.env.AWS_ENDPOINT_URL_LAMBDA ||
    process.env.AWS_ENDPOINT_URL ||
    `https://lambda.${region}.amazonaws.com`,
  fetch = globalThis.fetch,
  retryBaseMs = 100,
} = {}) {
  async function send(method, path, query, body) {
    const url = new URL(path, endpoint);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers = {
      "user-agent": `aws-durable-execution-sdk-js-lite/${VERSION}`,
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    for (let attempt = 1; ; attempt++) {
      // x-amz-date changes per attempt, so each attempt is signed again.
      const signed = signRequest({
        method,
        url,
        headers,
        body,
        credentials,
        region,
        service: "lambda",
      });
      // fetch derives host from the URL. The signed value is the same.
      delete signed.host;
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: signed,
          body,
          signal: AbortSignal.timeout(55_000),
        });
      } catch (err) {
        // A rejected fetch is a network error or a timeout. Both may succeed on retry.
        if (attempt >= MAX_ATTEMPTS) throw err;
        await backoff(attempt);
        continue;
      }
      const text = await res.text();
      if (res.ok) return text ? JSON.parse(text) : {};
      const data = parseOrEmpty(text);
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        continue;
      }
      throw toError(res, data);
    }
  }

  // Full jitter keeps concurrent retries from arriving together.
  const backoff = (attempt) =>
    sleep(Math.random() * retryBaseMs * 2 ** (attempt - 1));

  return {
    checkpoint({ DurableExecutionArn, CheckpointToken, Updates, ClientToken }) {
      // One token per call. Retries reuse it, so the service applies the call at most once.
      const body = JSON.stringify({
        CheckpointToken,
        ClientToken: ClientToken ?? randomUUID(),
        Updates,
      });
      return send(
        "POST",
        `${API}/${encodeRfc3986(DurableExecutionArn)}/checkpoint`,
        {},
        body,
      );
    },
    getExecutionState({
      DurableExecutionArn,
      CheckpointToken,
      Marker,
      MaxItems,
    }) {
      return send(
        "GET",
        `${API}/${encodeRfc3986(DurableExecutionArn)}/state`,
        { CheckpointToken, Marker, MaxItems },
        undefined,
      );
    },
  };
}

// Proxies can return non-JSON error pages. Those still need a clean HTTP error.
function parseOrEmpty(text) {
  try {
    return JSON.parse(text) ?? {};
  } catch {
    return {};
  }
}

function toError(res, data) {
  const name =
    res.headers.get("x-amzn-errortype")?.split(":")[0] ||
    data.__type?.split("#").pop() ||
    data.code ||
    "UnknownError";
  const err = new Error(data.message ?? data.Message ?? res.statusText);
  err.name = name;
  err.status = res.status;
  err.requestId = res.headers.get("x-amzn-requestid") ?? undefined;
  return err;
}
