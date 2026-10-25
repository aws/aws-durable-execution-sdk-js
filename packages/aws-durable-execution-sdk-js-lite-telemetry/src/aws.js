// A copy of the lite SDK's transport (src/transport/sigv4.js and lambda-client.js),
// adapted for generic POST calls. This package has no dependencies, so it cannot use the
// AWS SDK. The lite SDK does not export its transport. So the exporters sign and send
// their own requests with this file.

import { createHash, createHmac } from "node:crypto";

const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// SigV4 needs RFC 3986 encoding. encodeURIComponent leaves !'()* unencoded, so encode them too.
const encodeRfc3986 = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

export function signRequest({
  method,
  url,
  headers = {},
  body,
  credentials,
  region,
  service,
  date = new Date(),
}) {
  const u = typeof url === "string" ? new URL(url) : url;
  const amzDate = date.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);

  const out = { host: u.host, "x-amz-date": amzDate };
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase().trim()] = String(v).trim().replace(/\s+/g, " ");
  }
  if (credentials.sessionToken) {
    out["x-amz-security-token"] = credentials.sessionToken;
  }

  // Non-S3 services sign the already-encoded path encoded once more.
  // So each segment is encoded again, and "%" becomes "%25".
  const path = u.pathname.split("/").map(encodeRfc3986).join("/") || "/";
  const query = [...u.searchParams]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .sort(([ak, av], [bk, bv]) =>
      ak === bk ? (av < bv ? -1 : 1) : ak < bk ? -1 : 1,
    )
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const names = Object.keys(out).sort();
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    method,
    path,
    query,
    ...names.map((n) => `${n}:${out[n]}`),
    "",
    signedHeaders,
    sha256(body ?? ""),
  ].join("\n");

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");

  let key = hmac(`AWS4${credentials.secretAccessKey}`, day);
  for (const part of [region, service, "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key)
    .update(stringToSign)
    .digest("hex");

  out.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}

// Lambda puts credentials in environment variables. With SnapStart, it serves them from a
// container credentials endpoint instead, because a snapshot would keep stale ones. The
// exporters are created at module level. So the source reads the environment on each call.
function credentialSource(fetch) {
  let cached;
  return async () => {
    const env = process.env;
    if (env.AWS_ACCESS_KEY_ID) {
      return {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        sessionToken: env.AWS_SESSION_TOKEN,
      };
    }
    const uri = env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
    if (!uri) return {};
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

// send() POSTs one request signed for `service` and returns the parsed JSON response.
// It retries 429, 5xx and network errors up to 3 attempts in total.
export function createAwsClient({
  service,
  region = process.env.AWS_REGION,
  endpoint = `https://${service}.${region}.amazonaws.com`,
  credentials,
  fetch = globalThis.fetch,
  timeoutMs = 10_000,
  retryBaseMs = 100,
}) {
  const getCredentials = credentials
    ? async () => credentials
    : credentialSource(fetch);
  // Full jitter keeps concurrent retries from arriving together.
  const backoff = (attempt) =>
    sleep(Math.random() * retryBaseMs * 2 ** (attempt - 1));

  async function send({ path = "/", headers = {}, body }) {
    const url = new URL(path, endpoint);
    for (let attempt = 1; ; attempt++) {
      // x-amz-date changes per attempt, so each attempt is signed again.
      const signed = signRequest({
        method: "POST",
        url,
        headers,
        body,
        credentials: await getCredentials(),
        region,
        service,
      });
      // fetch derives host from the URL. The signed value is the same.
      delete signed.host;
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: signed,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // A rejected fetch is a network error or a timeout. Both may succeed on retry.
        if (attempt >= MAX_ATTEMPTS) throw err;
        await backoff(attempt);
        continue;
      }
      const text = await res.text();
      if (res.ok) return text ? JSON.parse(text) : {};
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        continue;
      }
      throw toError(res, parseOrEmpty(text));
    }
  }

  return { send };
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
  const err = new Error(data.message ?? data.Message ?? res.statusText);
  err.name =
    res.headers.get("x-amzn-errortype")?.split(":")[0] ||
    data.__type?.split("#").pop() ||
    data.code ||
    "UnknownError";
  err.status = res.status;
  err.requestId = res.headers.get("x-amzn-requestid") ?? undefined;
  return err;
}
