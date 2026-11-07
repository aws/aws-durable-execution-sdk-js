import { afterEach, describe, expect, it } from "vitest";
import {
  CheckpointUnrecoverableExecutionError,
  CheckpointUnrecoverableInvocationError,
} from "./checkpoint-errors/checkpoint-errors";
import { SerdesFailedError } from "./serdes-errors/serdes-errors";
import { createErrorObjectFromError } from "../utils/error-object/error-object";

// createErrorObjectFromError writes `error.name` as the checkpoint ErrorType
// for these errors. A minifying bundler can rename a class, so
// `constructor.name` becomes a short name such as "e". The stored ErrorType
// must stay the same anyway.
const cases: Array<[string, { name: string }, () => Error]> = [
  [
    "CheckpointUnrecoverableInvocationError",
    CheckpointUnrecoverableInvocationError,
    () => new CheckpointUnrecoverableInvocationError(),
  ],
  [
    "CheckpointUnrecoverableExecutionError",
    CheckpointUnrecoverableExecutionError,
    () => new CheckpointUnrecoverableExecutionError(),
  ],
  ["SerdesFailedError", SerdesFailedError, () => new SerdesFailedError()],
];

const renamed: Array<{ name: string }> = [];

afterEach(() => {
  for (const errorClass of renamed.splice(0)) {
    Reflect.deleteProperty(errorClass, "name");
  }
});

describe("unrecoverable error names", () => {
  it.each(cases)(
    "%s keeps its checkpoint ErrorType when the class is renamed",
    (expected, errorClass, create) => {
      Object.defineProperty(errorClass, "name", {
        value: "e",
        configurable: true,
      });
      renamed.push(errorClass);

      expect(createErrorObjectFromError(create()).ErrorType).toBe(expected);
    },
  );
});
