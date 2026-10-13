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

  it("lists and counts at most 10 errors", () => {
    const updates = Array.from({ length: 12 }, () => update({ Id: "bad id!" }));
    const error = rejection(updates) as Error;
    expect(error.message).toMatch(/^10 validation errors detected: /);
    expect(error.message).toContain("'updates.10.member.id'");
    expect(error.message).not.toContain("'updates.11.member.id'");
  });
});
