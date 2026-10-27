// Shared test helpers. The lite SDK is imported by relative path, because it is not
// installed in node_modules.

export {
  createInMemoryService,
  runDurable,
} from "../../aws-durable-execution-sdk-js-lite/test/helpers/run-durable.js";
export { createRetryStrategy } from "../../aws-durable-execution-sdk-js-lite/src/index.js";

// The ARN of the in-memory service.
export const ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:workflow:$LATEST/durable-execution/local/run";

// The in-memory service starts its clock at this time, in epoch seconds.
export const START_SECONDS = 1_700_000_000;

// An exporter that keeps every record it receives.
export function fakeExporter(extra = {}) {
  const records = [];
  return {
    records,
    async export(record) {
      records.push(structuredClone(record));
    },
    ...extra,
  };
}

// A client with send(request) that records each request. respond(request) returns the
// response or throws. request.json is the parsed body.
export function fakeClient(respond = () => ({})) {
  const requests = [];
  return {
    requests,
    async send(request) {
      const recorded = { ...request, json: JSON.parse(request.body) };
      requests.push(recorded);
      return respond(recorded);
    },
  };
}

export function jsonResponse(status, body, headers = {}) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers,
  });
}

// A fetch that records each call and returns the given responses in order. An Error in
// the list is thrown instead.
export function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: new URL(url), ...init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

// Sets the given environment variables for one test. Undefined deletes a variable.
const AWS_ENV = [
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN",
];
export function setAwsEnv(t, values) {
  const saved = Object.fromEntries(AWS_ENV.map((k) => [k, process.env[k]]));
  t.after(() => {
    for (const k of AWS_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  for (const k of AWS_ENV) {
    if (values[k] === undefined) delete process.env[k];
    else process.env[k] = values[k];
  }
}
