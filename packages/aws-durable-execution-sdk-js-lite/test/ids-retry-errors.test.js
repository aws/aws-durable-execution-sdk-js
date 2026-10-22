import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  DurableOperationError,
  fromErrorObject,
  toErrorObject,
} from "../src/errors.js";
import { hashId } from "../src/ids.js";
import { createRetryStrategy, defaultRetryStrategy } from "../src/retry.js";

test("hashId matches known values of the full SDK algorithm", () => {
  // Values produced by running the full SDK's step-id-utils.ts.
  const known = {
    1: "c4ca4238a0b92382",
    2: "c81e728d9d4c2f63",
    "1-1": "ea66c06c1e1c05fa",
    "3-2-4": "526af9ed08884738",
    "execution-result-0": "f2e945f608594c90",
  };
  for (const [raw, hashed] of Object.entries(known)) {
    assert.equal(hashId(raw), hashed);
    const md5 = createHash("md5").update(raw).digest("hex");
    assert.equal(hashed, md5.slice(0, 16));
  }
});

test("createRetryStrategy without jitter uses capped exponential backoff", () => {
  const retry = createRetryStrategy({ jitter: false });
  const delays = [1, 2, 3, 4, 5].map(
    (attempt) => retry({ error: new Error(), attempt }).delaySeconds,
  );
  assert.deepEqual(delays, [5, 10, 20, 40, 60]);
  assert.deepEqual(retry({ error: new Error(), attempt: 6 }), {
    shouldRetry: false,
  });
});

test("createRetryStrategy honors options", () => {
  const retry = createRetryStrategy({
    maxAttempts: 3,
    initialDelaySeconds: 0.2,
    backoffRate: 3,
    maxDelaySeconds: 100,
    jitter: false,
    shouldRetry: ({ error }) => error.message !== "fatal",
  });
  // 0.2 rounds to 0, so the 1 second floor applies.
  assert.deepEqual(retry({ error: new Error("x"), attempt: 1 }), {
    shouldRetry: true,
    delaySeconds: 1,
  });
  assert.equal(retry({ error: new Error("x"), attempt: 2 }).delaySeconds, 1);
  assert.equal(retry({ error: new Error("x"), attempt: 3 }).shouldRetry, false);
  assert.equal(
    retry({ error: new Error("fatal"), attempt: 1 }).shouldRetry,
    false,
  );
});

test("full jitter stays within [1, delay]", () => {
  for (let i = 0; i < 50; i++) {
    const { shouldRetry, delaySeconds } = defaultRetryStrategy({
      error: new Error(),
      attempt: 3,
    });
    assert.equal(shouldRetry, true);
    assert.ok(delaySeconds >= 1 && delaySeconds <= 20);
  }
});

test("ErrorObject conversion round-trips", () => {
  const err = new TypeError("bad");
  assert.deepEqual(toErrorObject(err), {
    ErrorType: "TypeError",
    ErrorMessage: "bad",
  });
  assert.deepEqual(toErrorObject("plain"), {
    ErrorType: "Error",
    ErrorMessage: "plain",
  });
  const back = fromErrorObject({
    ErrorType: "T",
    ErrorMessage: "m",
    ErrorData: "d",
  });
  assert.ok(back instanceof DurableOperationError);
  assert.equal(back.name, "DurableOperationError");
  assert.deepEqual(toErrorObject(back), {
    ErrorType: "T",
    ErrorMessage: "m",
    ErrorData: "d",
  });
  // Only DurableOperationError supplies errorType and data. Other libraries put objects
  // in `data`, and the service rejects a non-string ErrorData.
  class FetchError extends Error {
    constructor(message, data) {
      super(message);
      this.name = "FetchError";
      this.errorType = "Custom";
      this.data = data;
    }
  }
  assert.deepEqual(toErrorObject(new FetchError("503", { code: "busy" })), {
    ErrorType: "FetchError",
    ErrorMessage: "503",
  });
  const empty = fromErrorObject(undefined, "StepError");
  assert.equal(empty.errorType, "StepError");
  assert.equal(empty.message, "Unknown error");
});
