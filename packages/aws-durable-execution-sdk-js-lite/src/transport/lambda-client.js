import { randomUUID } from "node:crypto";
import { VERSION } from "../version.js";
import { encodeRfc3986, signRequest } from "./sigv4.js";

const API = "/2025-12-01/durable-executions";
const MAX_ATTEMPTS = 3;
// The time that the SDK keeps to end the invocation before its deadline.
const MARGIN_MS = 500;
// The global timer, not node:timers/promises, which LLRT does not provide.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Lambda puts credentials in environment variables. With SnapStart, it serves them from a
// container credentials endpoint instead, because a snapshot would keep stale ones.
function credentialSource(fetch) {
  const env = process.env;
  if (env.AWS_ACCESS_KEY_ID) {
    const creds = {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      sessionToken: env.AWS_SESSION_TOKEN,
    };
    return async () => creds;
  }
  const uri = env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  if (!uri) return async () => ({});
  let cached;
  return async () => {
    // Refresh 5 minutes before expiry, like the AWS SDK.
    if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached;
    const res = await fetch(uri, {
      headers: { authorization: env.AWS_CONTAINER_AUTHORIZATION_TOKEN ?? "" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      throw new Error(
        `Container credentials request failed: HTTP ${res.status}`,
      );
    }
    const c = await res.json();
    cached = {
      accessKeyId: c.AccessKeyId,
      secretAccessKey: c.SecretAccessKey,
      sessionToken: c.Token,
      expiresAt: Date.parse(c.Expiration),
    };
    return cached;
  };
}

export function createLambdaClient({
  region = process.env.AWS_REGION,
  credentials,
  endpoint = process.env.AWS_ENDPOINT_URL_LAMBDA ||
    process.env.AWS_ENDPOINT_URL ||
    `https://lambda.${region}.amazonaws.com`,
  fetch = globalThis.fetch,
  retryBaseMs = 100,
  // Epoch milliseconds when the invocation times out. Infinity keeps 55 s per attempt.
  deadline = Infinity,
} = {}) {
  const getCredentials = credentials
    ? async () => credentials
    : credentialSource(fetch);

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
      // On Lambda Managed Instances, a timeout does not stop the code. So no attempt
      // runs past the deadline. The error has no status, so the handler throws to
      // Lambda (README 2.8). The invocation is about to time out anyway.
      const timeout = Math.min(55_000, deadline - Date.now() - MARGIN_MS);
      if (timeout <= 0) {
        const err = new Error("Less than 500 ms left in the invocation");
        err.name = "DeadlineExceededError";
        throw err;
      }
      // x-amz-date changes per attempt, so each attempt is signed again.
      const signed = signRequest({
        method,
        url,
        headers,
        body,
        credentials: await getCredentials(),
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
          signal: AbortSignal.timeout(timeout),
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
