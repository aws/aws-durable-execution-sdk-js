import {
  OperationAction,
  OperationType,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";
import { validateUpdateModel } from "../validate-update-model";

const update = (fields: Partial<OperationUpdate> = {}): OperationUpdate => ({
  Id: "op-1",
  Type: OperationType.STEP,
  Action: OperationAction.START,
  ...fields,
});

const rejection = (updates: OperationUpdate[]): unknown => {
  try {
    validateUpdateModel(updates);
  } catch (error) {
    return error;
  }
  return undefined;
};

const ID_PATTERN = "[a-zA-Z0-9-_]+";
const NAME_PATTERN = "[\\x20-\\x7E]+";

// The messages below are the service's, recorded from
// CheckpointDurableExecution in us-east-1.
describe("validateUpdateModel", () => {
  it.each([
    ["the required members only", update()],
    ["a default subtype", update({ SubType: "Step" })],
    [
      "letters, digits, hyphen, and underscore",
      update({ SubType: "Order-Charge_2", Id: "a-B_9", ParentId: "p-1" }),
    ],
    ["a 32-character subtype", update({ SubType: "x".repeat(32) })],
    ["a 64-character id", update({ Id: "x".repeat(64) })],
    [
      "a 256-character printable ASCII name",
      update({ Name: " ~".repeat(128) }),
    ],
  ])("accepts %s", (_label, accepted) => {
    expect(() => validateUpdateModel([accepted])).not.toThrow();
  });

  it("rejects a subtype over 32 characters like the service", () => {
    expect(rejection([update({ SubType: "x".repeat(33) })])).toMatchObject({
      name: "ValidationException",
      $fault: "client",
      $metadata: { httpStatusCode: 400 },
      message: `1 validation error detected: Value '${"x".repeat(33)}' at 'updates.1.member.subType' failed to satisfy constraint: Member must have length less than or equal to 32`,
    });
  });

  it("rejects a subtype outside the pattern like the service", () => {
    expect(rejection([update({ SubType: "bad subtype!" })])).toMatchObject({
      name: "ValidationException",
      $metadata: { httpStatusCode: 400 },
      message: `1 validation error detected: Value 'bad subtype!' at 'updates.1.member.subType' failed to satisfy constraint: Member must satisfy regular expression pattern: ${ID_PATTERN}`,
    });
  });

  it("rejects a name that is not printable ASCII", () => {
    expect(rejection([update({ Name: "héllo" })])).toMatchObject({
      name: "ValidationException",
      message: `1 validation error detected: Value 'héllo' at 'updates.1.member.name' failed to satisfy constraint: Member must satisfy regular expression pattern: ${NAME_PATTERN}`,
    });
  });

  it("rejects a name over 256 characters and an id over 64 characters", () => {
    const name = "n".repeat(257);
    const id = "a".repeat(65);
    expect(rejection([update({ Id: id, Name: name })])).toMatchObject({
      message: `2 validation errors detected: Value '${name}' at 'updates.1.member.name' failed to satisfy constraint: Member must have length less than or equal to 256; Value '${id}' at 'updates.1.member.id' failed to satisfy constraint: Member must have length less than or equal to 64`,
    });
  });

  it("rejects a missing id", () => {
    expect(rejection([update({ Id: undefined })])).toMatchObject({
      name: "ValidationException",
      message:
        "1 validation error detected: Value null at 'updates.1.member.id' failed to satisfy constraint: Member must not be null",
    });
  });

  it("rejects a missing type and action", () => {
    expect(
      rejection([update({ Type: undefined, Action: undefined })]),
    ).toMatchObject({
      message:
        "2 validation errors detected: Value null at 'updates.1.member.type' failed to satisfy constraint: Member must not be null; Value null at 'updates.1.member.action' failed to satisfy constraint: Member must not be null",
    });
  });

  // A pattern must match the whole value. A trailing line terminator is
  // outside every pattern, so the service rejects it.
  it.each([
    ["\\n", "\n"],
    ["\\r", "\r"],
    ["\\r\\n", "\r\n"],
    ["U+2028", "\u2028"],
    ["U+2029", "\u2029"],
  ])("rejects a name that ends with %s", (_label, terminator) => {
    const name = `charge${terminator}`;
    expect(rejection([update({ Name: name })])).toMatchObject({
      message: `1 validation error detected: Value '${name}' at 'updates.1.member.name' failed to satisfy constraint: Member must satisfy regular expression pattern: ${NAME_PATTERN}`,
    });
  });

  it("rejects an id and a subtype that end with \\n", () => {
    expect(rejection([update({ Id: "a\n", SubType: "Step\n" })])).toMatchObject(
      {
        message: `2 validation errors detected: Value 'Step\n' at 'updates.1.member.subType' failed to satisfy constraint: Member must satisfy regular expression pattern: ${ID_PATTERN}; Value 'a\n' at 'updates.1.member.id' failed to satisfy constraint: Member must satisfy regular expression pattern: ${ID_PATTERN}`,
      },
    );
  });

  it("reports both the length and the pattern of an empty string", () => {
    expect(rejection([update({ Id: "", Name: "" })])).toMatchObject({
      message: `4 validation errors detected: Value '' at 'updates.1.member.name' failed to satisfy constraint: Member must have length greater than or equal to 1; Value '' at 'updates.1.member.name' failed to satisfy constraint: Member must satisfy regular expression pattern: ${NAME_PATTERN}; Value '' at 'updates.1.member.id' failed to satisfy constraint: Member must have length greater than or equal to 1; Value '' at 'updates.1.member.id' failed to satisfy constraint: Member must satisfy regular expression pattern: ${ID_PATTERN}`,
    });
  });

  it("reports the members of an update in the service's order", () => {
    expect(
      rejection([
        update({
          Id: "bad id!",
          ParentId: "p.q",
          Name: "héllo",
          SubType: "bad sub!",
        }),
      ]),
    ).toMatchObject({
      message: `4 validation errors detected: Value 'p.q' at 'updates.1.member.parentId' failed to satisfy constraint: Member must satisfy regular expression pattern: ${ID_PATTERN}; Value 'héllo' at 'updates.1.member.name' failed to satisfy constraint: Member must satisfy regular expression pattern: ${NAME_PATTERN}; Value 'bad sub!' at 'updates.1.member.subType' failed to satisfy constraint: Member must satisfy regular expression pattern: ${ID_PATTERN}; Value 'bad id!' at 'updates.1.member.id' failed to satisfy constraint: Member must satisfy regular expression pattern: ${ID_PATTERN}`,
    });
  });

  it("lists every invalid update by its 1-based position", () => {
    expect(
      rejection([
        update({ SubType: "Step" }),
        update({ SubType: "bad subtype!" }),
        update({ SubType: "x".repeat(33) }),
      ]),
    ).toMatchObject({
      message: `2 validation errors detected: Value 'bad subtype!' at 'updates.2.member.subType' failed to satisfy constraint: Member must satisfy regular expression pattern: ${ID_PATTERN}; Value '${"x".repeat(33)}' at 'updates.3.member.subType' failed to satisfy constraint: Member must have length less than or equal to 32`,
    });
  });

  it("reports both constraints for a subtype that fails both", () => {
    const subType = "y ".repeat(17);
    expect(rejection([update({ SubType: subType })])).toMatchObject({
      message: `2 validation errors detected: Value '${subType}' at 'updates.1.member.subType' failed to satisfy constraint: Member must have length less than or equal to 32; Value '${subType}' at 'updates.1.member.subType' failed to satisfy constraint: Member must satisfy regular expression pattern: ${ID_PATTERN}`,
    });
  });

  // The service checks the pattern even when the length check fails. So an
  // empty subtype gets 2 errors, as an empty id or name does.
  it("reports both the length and the pattern of an empty subtype", () => {
    expect(rejection([update({ SubType: "" })])).toMatchObject({
      name: "ValidationException",
      message: `2 validation errors detected: Value '' at 'updates.1.member.subType' failed to satisfy constraint: Member must have length greater than or equal to 1; Value '' at 'updates.1.member.subType' failed to satisfy constraint: Member must satisfy regular expression pattern: ${ID_PATTERN}`,
    });
  });

  describe("options members", () => {
    const FUNCTION_NAME_PATTERN =
      "(arn:(aws[a-zA-Z-]*)?:lambda:)?((eusc-)?[a-z]{2}((-gov)|(-iso([a-z]?)))?-[a-z]+-\\d{1}:)?(\\d{12}:)?(function:)?([a-zA-Z0-9-_\\.]+)(:(\\$LATEST(\\.PUBLISHED)?|[a-zA-Z0-9-_]+))?";

    const invoke = (
      ChainedInvokeOptions: OperationUpdate["ChainedInvokeOptions"],
    ): OperationUpdate =>
      update({ Type: OperationType.CHAINED_INVOKE, ChainedInvokeOptions });

    it.each([
      ["a local function name", "child-function"],
      ["a qualified name", "my-function:$LATEST"],
      [
        "a function ARN",
        "arn:aws:lambda:us-east-1:123456789012:function:my-fn:$LATEST.PUBLISHED",
      ],
    ])("accepts %s", (_label, FunctionName) => {
      expect(() =>
        validateUpdateModel([invoke({ FunctionName, TenantId: "tenant-1" })]),
      ).not.toThrow();
    });

    it("accepts absent options", () => {
      expect(() => validateUpdateModel([update()])).not.toThrow();
    });

    it("requires FunctionName when ChainedInvokeOptions is present", () => {
      expect(rejection([invoke({ FunctionName: undefined })])).toMatchObject({
        name: "ValidationException",
        $metadata: { httpStatusCode: 400 },
        message:
          "1 validation error detected: Value null at 'updates.1.member.chainedInvokeOptions.functionName' failed to satisfy constraint: Member must not be null",
      });
    });

    it("rejects an empty FunctionName", () => {
      expect(rejection([invoke({ FunctionName: "" })])).toMatchObject({
        message: `2 validation errors detected: Value '' at 'updates.1.member.chainedInvokeOptions.functionName' failed to satisfy constraint: Member must have length greater than or equal to 1; Value '' at 'updates.1.member.chainedInvokeOptions.functionName' failed to satisfy constraint: Member must satisfy regular expression pattern: ${FUNCTION_NAME_PATTERN}`,
      });
    });

    it("rejects a FunctionName over 256 characters", () => {
      const name = "f".repeat(300);
      expect(rejection([invoke({ FunctionName: name })])).toMatchObject({
        message: `1 validation error detected: Value '${name}' at 'updates.1.member.chainedInvokeOptions.functionName' failed to satisfy constraint: Member must have length less than or equal to 256`,
      });
    });

    it("rejects a FunctionName outside the pattern", () => {
      expect(rejection([invoke({ FunctionName: "bad name!" })])).toMatchObject({
        message: `1 validation error detected: Value 'bad name!' at 'updates.1.member.chainedInvokeOptions.functionName' failed to satisfy constraint: Member must satisfy regular expression pattern: ${FUNCTION_NAME_PATTERN}`,
      });
    });

    it("rejects a TenantId outside the pattern", () => {
      expect(
        rejection([invoke({ FunctionName: "f", TenantId: "bad!tenant" })]),
      ).toMatchObject({
        message:
          "1 validation error detected: Value 'bad!tenant' at 'updates.1.member.chainedInvokeOptions.tenantId' failed to satisfy constraint: Member must satisfy regular expression pattern: [a-zA-Z0-9\\._:\\/=+\\-@ ]+",
      });
    });

    it.each([
      [
        "WaitSeconds below 1",
        update({ Type: OperationType.WAIT, WaitOptions: { WaitSeconds: 0 } }),
        "Value '0' at 'updates.1.member.waitOptions.waitSeconds' failed to satisfy constraint: Member must have value greater than or equal to 1",
      ],
      [
        "WaitSeconds above 31622400",
        update({
          Type: OperationType.WAIT,
          WaitOptions: { WaitSeconds: 31622401 },
        }),
        "Value '31622401' at 'updates.1.member.waitOptions.waitSeconds' failed to satisfy constraint: Member must have value less than or equal to 31622400",
      ],
      [
        "NextAttemptDelaySeconds below 1",
        update({
          Action: OperationAction.RETRY,
          StepOptions: { NextAttemptDelaySeconds: 0 },
        }),
        "Value '0' at 'updates.1.member.stepOptions.nextAttemptDelaySeconds' failed to satisfy constraint: Member must have value greater than or equal to 1",
      ],
    ])("rejects %s", (_label, rejected, error) => {
      expect(rejection([rejected])).toMatchObject({
        message: `1 validation error detected: ${error}`,
      });
    });

    it("rejects callback timeouts out of range", () => {
      expect(
        rejection([
          update({
            Type: OperationType.CALLBACK,
            CallbackOptions: {
              TimeoutSeconds: -1,
              HeartbeatTimeoutSeconds: 100000000,
            },
          }),
        ]),
      ).toMatchObject({
        message:
          "2 validation errors detected: Value '-1' at 'updates.1.member.callbackOptions.timeoutSeconds' failed to satisfy constraint: Member must have value greater than or equal to 0; Value '100000000' at 'updates.1.member.callbackOptions.heartbeatTimeoutSeconds' failed to satisfy constraint: Member must have value less than or equal to 99999999",
      });
    });

    it("reports options members in the service's order", () => {
      expect(
        rejection([
          {
            Id: "bad id!",
            Type: OperationType.CHAINED_INVOKE,
            Action: OperationAction.START,
            Name: "héllo",
            ChainedInvokeOptions: { FunctionName: undefined },
            WaitOptions: { WaitSeconds: 0 },
            StepOptions: { NextAttemptDelaySeconds: 0 },
            CallbackOptions: { TimeoutSeconds: -1 },
          },
        ]),
      ).toMatchObject({
        message: `6 validation errors detected: Value null at 'updates.1.member.chainedInvokeOptions.functionName' failed to satisfy constraint: Member must not be null; Value '-1' at 'updates.1.member.callbackOptions.timeoutSeconds' failed to satisfy constraint: Member must have value greater than or equal to 0; Value '0' at 'updates.1.member.waitOptions.waitSeconds' failed to satisfy constraint: Member must have value greater than or equal to 1; Value '0' at 'updates.1.member.stepOptions.nextAttemptDelaySeconds' failed to satisfy constraint: Member must have value greater than or equal to 1; Value 'héllo' at 'updates.1.member.name' failed to satisfy constraint: Member must satisfy regular expression pattern: ${NAME_PATTERN}; Value 'bad id!' at 'updates.1.member.id' failed to satisfy constraint: Member must satisfy regular expression pattern: ${ID_PATTERN}`,
      });
    });

    it("reports options members between the other members", () => {
      expect(
        rejection([
          {
            Id: "x",
            Type: undefined as unknown as OperationType,
            Action: OperationAction.START,
            ParentId: "p.q",
            CallbackOptions: { TimeoutSeconds: -1 },
            WaitOptions: { WaitSeconds: 0 },
          },
        ]),
      ).toMatchObject({
        message: `4 validation errors detected: Value '-1' at 'updates.1.member.callbackOptions.timeoutSeconds' failed to satisfy constraint: Member must have value greater than or equal to 0; Value null at 'updates.1.member.type' failed to satisfy constraint: Member must not be null; Value 'p.q' at 'updates.1.member.parentId' failed to satisfy constraint: Member must satisfy regular expression pattern: ${ID_PATTERN}; Value '0' at 'updates.1.member.waitOptions.waitSeconds' failed to satisfy constraint: Member must have value greater than or equal to 1`,
      });
    });
  });

  describe("integer members", () => {
    const wait = (WaitSeconds: number): OperationUpdate =>
      update({ Type: OperationType.WAIT, WaitOptions: { WaitSeconds } });

    // The service reads a number for an integer member without its
    // fractional part, and clamps it to the 32-bit range. It checks the
    // integer that it read.
    it.each([
      ["1.5", 1.5],
      ["31622400.9", 31622400.9],
    ])(
      "accepts %s seconds, which the service reads as an integer",
      (_label, seconds) => {
        expect(() => validateUpdateModel([wait(seconds)])).not.toThrow();
      },
    );

    it.each([
      [
        "0.5 as 0",
        0.5,
        "Value '0' at 'updates.1.member.waitOptions.waitSeconds' failed to satisfy constraint: Member must have value greater than or equal to 1",
      ],
      [
        "1e12 as the largest 32-bit integer",
        1e12,
        "Value '2147483647' at 'updates.1.member.waitOptions.waitSeconds' failed to satisfy constraint: Member must have value less than or equal to 31622400",
      ],
      [
        "-1e12 as the smallest 32-bit integer",
        -1e12,
        "Value '-2147483648' at 'updates.1.member.waitOptions.waitSeconds' failed to satisfy constraint: Member must have value greater than or equal to 1",
      ],
    ])("reads %s", (_label, seconds, error) => {
      expect(rejection([wait(seconds)])).toMatchObject({
        name: "ValidationException",
        message: `1 validation error detected: ${error}`,
      });
    });
  });

  it("lists and counts at most 10 errors", () => {
    const updates = Array.from({ length: 12 }, () => update({ Id: "bad id!" }));
    const error = rejection(updates) as Error;
    expect(error.message).toMatch(/^10 validation errors detected: /);
    expect(error.message).toContain("'updates.10.member.id'");
    expect(error.message).not.toContain("'updates.11.member.id'");
  });
});
