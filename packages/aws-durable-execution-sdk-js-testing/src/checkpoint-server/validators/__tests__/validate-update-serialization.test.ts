import {
  OperationAction,
  OperationType,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";
import { validateUpdateSerialization } from "../validate-update-serialization";

/** Builds an update with members of any JSON type, as a handler can. */
const update = (fields: Record<string, unknown> = {}): OperationUpdate =>
  ({
    Id: "op-1",
    Type: OperationType.STEP,
    Action: OperationAction.START,
    ...fields,
  }) as unknown as OperationUpdate;

const rejection = (updates: OperationUpdate[]): unknown => {
  try {
    validateUpdateSerialization(updates);
  } catch (error) {
    return error;
  }
  return undefined;
};

const TO_STRING = "can not be converted to a String";
const TO_INTEGER = "can not be converted to an Integer";
const OBJECT_NOT_EXPECTED =
  "Start of structure or map found where not expected.";
const ARRAY_NOT_EXPECTED = "Start of list found where not expected";

// The messages and the order below are the service's, recorded from
// CheckpointDurableExecution in us-east-1.
describe("validateUpdateSerialization", () => {
  it("accepts an update of the right types", () => {
    expect(() =>
      validateUpdateSerialization([
        update({
          ParentId: "p",
          Name: "n",
          SubType: "Step",
          Payload: "1",
          Error: {
            ErrorData: "d",
            ErrorMessage: "m",
            ErrorType: "t",
            StackTrace: ["a", null],
          },
          ContextOptions: { ReplayChildren: true },
          StepOptions: { NextAttemptDelaySeconds: 1.5 },
          WaitOptions: { WaitSeconds: 1 },
          CallbackOptions: { TimeoutSeconds: 0, HeartbeatTimeoutSeconds: 0 },
          ChainedInvokeOptions: { FunctionName: "f", TenantId: "t" },
        }),
      ]),
    ).not.toThrow();
  });

  it("rejects with the service's exception", () => {
    expect(rejection([update({ Name: 1 })])).toMatchObject({
      name: "SerializationException",
      $fault: "client",
      $metadata: { httpStatusCode: 400 },
      message: `NUMBER_VALUE ${TO_STRING}`,
    });
  });

  it.each([
    ["a number", 123, `NUMBER_VALUE ${TO_STRING}`],
    ["true", true, `TRUE_VALUE ${TO_STRING}`],
    ["false", false, `FALSE_VALUE ${TO_STRING}`],
    ["an object", { x: 1 }, OBJECT_NOT_EXPECTED],
    ["an array", [1], ARRAY_NOT_EXPECTED],
  ])("rejects %s for a string member", (_label, Name, message) => {
    expect(rejection([update({ Name })])).toMatchObject({ message });
  });

  it.each([
    ["a string", "5", `STRING_VALUE ${TO_INTEGER}`],
    ["NaN", Number.NaN, `STRING_VALUE ${TO_INTEGER}`],
    ["Infinity", Number.POSITIVE_INFINITY, `STRING_VALUE ${TO_INTEGER}`],
    ["-Infinity", Number.NEGATIVE_INFINITY, `STRING_VALUE ${TO_INTEGER}`],
    ["true", true, `TRUE_VALUE ${TO_INTEGER}`],
    ["false", false, `FALSE_VALUE ${TO_INTEGER}`],
    ["an object", { x: 1 }, OBJECT_NOT_EXPECTED],
    ["an array", [1], ARRAY_NOT_EXPECTED],
  ])("rejects %s for an integer member", (_label, WaitSeconds, message) => {
    expect(
      rejection([update({ Type: "WAIT", WaitOptions: { WaitSeconds } })]),
    ).toMatchObject({ message });
  });

  describe("members outside the model constraints", () => {
    it.each([
      ["Payload", { Payload: 1 }, `NUMBER_VALUE ${TO_STRING}`],
      [
        "Error.ErrorMessage",
        { Error: { ErrorMessage: 1, ErrorType: "X" } },
        `NUMBER_VALUE ${TO_STRING}`,
      ],
      [
        "an element of Error.StackTrace",
        { Error: { StackTrace: [1] } },
        `NUMBER_VALUE ${TO_STRING}`,
      ],
      [
        "an object element of Error.StackTrace",
        { Error: { StackTrace: [{ a: 1 }] } },
        OBJECT_NOT_EXPECTED,
      ],
      [
        "a string for Error.StackTrace",
        { Error: { StackTrace: "x" } },
        "Expected list or null",
      ],
      [
        "an object for Error.StackTrace",
        { Error: { StackTrace: { a: 1 } } },
        OBJECT_NOT_EXPECTED,
      ],
      [
        "a number for ContextOptions.ReplayChildren",
        { ContextOptions: { ReplayChildren: 1 } },
        "NUMBER_VALUE can not be converted to a Boolean",
      ],
      [
        "an object for ContextOptions.ReplayChildren",
        { ContextOptions: { ReplayChildren: {} } },
        OBJECT_NOT_EXPECTED,
      ],
      [
        "an array for ContextOptions.ReplayChildren",
        { ContextOptions: { ReplayChildren: [] } },
        ARRAY_NOT_EXPECTED,
      ],
      ["a string for Error", { Error: "boom" }, "Expected null"],
      ["a number for WaitOptions", { WaitOptions: 5 }, "Expected null"],
      ["true for WaitOptions", { WaitOptions: true }, "Expected null"],
    ])("rejects %s", (_label, fields, message) => {
      expect(rejection([update(fields)])).toMatchObject({ message });
    });

    it.each([
      [
        "a string for ReplayChildren",
        { ContextOptions: { ReplayChildren: "yes" } },
      ],
      ["an array for WaitOptions", { WaitOptions: [1] }],
      ["a null element of StackTrace", { Error: { StackTrace: [null] } }],
    ])("accepts %s, as the service does", (_label, fields) => {
      expect(() => validateUpdateSerialization([update(fields)])).not.toThrow();
    });

    it("rejects an update that is not an object", () => {
      expect(rejection(["x" as unknown as OperationUpdate])).toMatchObject({
        message: "Expected null",
      });
    });
  });

  // The service reads the members of a structure in alphabetical order of
  // their names, whatever their order in the body. It reports the first
  // member it cannot read.
  describe("order", () => {
    it.each([
      ["Action before Id", { Id: 5, Action: true }, `TRUE_VALUE ${TO_STRING}`],
      [
        "Action before Id, when Id is true",
        { Id: true, Action: 5 },
        `NUMBER_VALUE ${TO_STRING}`,
      ],
      ["Id before Name", { Name: true, Id: 5 }, `NUMBER_VALUE ${TO_STRING}`],
      [
        "Name before Type",
        { Type: true, Name: 5 },
        `NUMBER_VALUE ${TO_STRING}`,
      ],
      [
        "ParentId before Payload",
        { Payload: true, ParentId: 5 },
        `NUMBER_VALUE ${TO_STRING}`,
      ],
      [
        "Error before Id",
        { Id: 5, Error: { ErrorMessage: true } },
        `TRUE_VALUE ${TO_STRING}`,
      ],
      [
        "ErrorData before StackTrace",
        { Error: { StackTrace: [true], ErrorData: 5 } },
        `NUMBER_VALUE ${TO_STRING}`,
      ],
      [
        "ErrorMessage before ErrorType",
        { Error: { ErrorType: true, ErrorMessage: 5 } },
        `NUMBER_VALUE ${TO_STRING}`,
      ],
      [
        "ContextOptions before Error",
        {
          ContextOptions: { ReplayChildren: 5 },
          Error: { ErrorData: true },
        },
        "NUMBER_VALUE can not be converted to a Boolean",
      ],
      [
        "ChainedInvokeOptions before ContextOptions",
        {
          ContextOptions: { ReplayChildren: 5 },
          ChainedInvokeOptions: { FunctionName: true },
        },
        `TRUE_VALUE ${TO_STRING}`,
      ],
      [
        "ChainedInvokeOptions before WaitOptions",
        {
          WaitOptions: { WaitSeconds: true },
          ChainedInvokeOptions: { FunctionName: 5 },
        },
        `NUMBER_VALUE ${TO_STRING}`,
      ],
      [
        "StepOptions before WaitOptions",
        {
          WaitOptions: { WaitSeconds: "x" },
          StepOptions: { NextAttemptDelaySeconds: true },
        },
        `TRUE_VALUE ${TO_INTEGER}`,
      ],
    ])("reads %s", (_label, fields, message) => {
      expect(rejection([update(fields)])).toMatchObject({ message });
    });

    it("reads the updates in order", () => {
      expect(
        rejection([update({ Name: true }), update({ Name: 1 })]),
      ).toMatchObject({ message: `TRUE_VALUE ${TO_STRING}` });
    });
  });
});
