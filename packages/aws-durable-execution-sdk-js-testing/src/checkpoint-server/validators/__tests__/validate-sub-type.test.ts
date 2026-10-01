import { OperationAction, OperationType } from "@aws/durable-execution-sdk-js";
import { validateSubTypes } from "../validate-sub-type";

const update = (SubType?: string) => ({
  Id: "op-1",
  Type: OperationType.STEP,
  Action: OperationAction.START,
  SubType,
});

const rejection = (updates: ReturnType<typeof update>[]): unknown => {
  try {
    validateSubTypes(updates);
  } catch (error) {
    return error;
  }
  return undefined;
};

describe("validateSubTypes", () => {
  it.each([
    ["no subtype", undefined],
    ["a default subtype", "Step"],
    ["letters, digits, hyphen, and underscore", "Order-Charge_2"],
    ["32 characters", "x".repeat(32)],
  ])("accepts %s", (_label, subType) => {
    expect(() => validateSubTypes([update(subType)])).not.toThrow();
  });

  // The messages below are the service's, recorded from
  // CheckpointDurableExecution in us-east-1.
  it("rejects a subtype over 32 characters like the service", () => {
    expect(rejection([update("x".repeat(33))])).toMatchObject({
      name: "ValidationException",
      $fault: "client",
      $metadata: { httpStatusCode: 400 },
      message: `1 validation error detected: Value '${"x".repeat(33)}' at 'updates.1.member.subType' failed to satisfy constraint: Member must have length less than or equal to 32`,
    });
  });

  it("rejects a subtype outside the pattern like the service", () => {
    expect(rejection([update("bad subtype!")])).toMatchObject({
      name: "ValidationException",
      $metadata: { httpStatusCode: 400 },
      message:
        "1 validation error detected: Value 'bad subtype!' at 'updates.1.member.subType' failed to satisfy constraint: Member must satisfy regular expression pattern: [a-zA-Z0-9-_]+",
    });
  });

  it("lists every invalid update by its 1-based position", () => {
    expect(
      rejection([
        update("Step"),
        update("bad subtype!"),
        update("x".repeat(33)),
      ]),
    ).toMatchObject({
      message: `2 validation errors detected: Value 'bad subtype!' at 'updates.2.member.subType' failed to satisfy constraint: Member must satisfy regular expression pattern: [a-zA-Z0-9-_]+; Value '${"x".repeat(33)}' at 'updates.3.member.subType' failed to satisfy constraint: Member must have length less than or equal to 32`,
    });
  });

  it("reports both constraints for a subtype that fails both", () => {
    const subType = "y ".repeat(17);
    expect(rejection([update(subType)])).toMatchObject({
      message: `2 validation errors detected: Value '${subType}' at 'updates.1.member.subType' failed to satisfy constraint: Member must have length less than or equal to 32; Value '${subType}' at 'updates.1.member.subType' failed to satisfy constraint: Member must satisfy regular expression pattern: [a-zA-Z0-9-_]+`,
    });
  });

  it("rejects an empty subtype", () => {
    expect(rejection([update("")])).toMatchObject({
      name: "ValidationException",
      message:
        "1 validation error detected: Value '' at 'updates.1.member.subType' failed to satisfy constraint: Member must have length greater than or equal to 1",
    });
  });
});
