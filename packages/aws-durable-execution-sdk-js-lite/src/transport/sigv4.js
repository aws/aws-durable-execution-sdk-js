import { createHash, createHmac } from "node:crypto";

// SigV4 needs RFC 3986 encoding. encodeURIComponent leaves !'()* unencoded, so encode them too.
export function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// Non-S3 services sign the already-encoded path encoded once more.
// So each segment is encoded again, and "%" becomes "%25".
export function canonicalUri(pathname) {
  return pathname.split("/").map(encodeRfc3986).join("/") || "/";
}

function canonicalQuery(searchParams) {
  return [...searchParams]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .sort(([ak, av], [bk, bv]) =>
      ak === bk ? (av < bv ? -1 : 1) : ak < bk ? -1 : 1,
    )
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

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

  const names = Object.keys(out).sort();
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    method,
    canonicalUri(u.pathname),
    canonicalQuery(u.searchParams),
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
