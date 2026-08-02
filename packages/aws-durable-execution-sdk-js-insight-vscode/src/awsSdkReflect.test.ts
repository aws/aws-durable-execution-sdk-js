import { listActions, reflectAction } from "./awsSdkReflect";

// These run against clients already installed in the tree (no network).
describe("awsSdkReflect", () => {
  it("lists a client's operations without the Command suffix", async () => {
    const info = await listActions("@aws-sdk/client-dynamodb");
    const names = info.actions.map((a) => a.name);
    expect(info.clientClass).toBe("DynamoDBClient");
    expect(names).toContain("PutItem");
    expect(names).toContain("GetItem");
    // sorted + command class preserved
    expect(info.actions.find((a) => a.name === "PutItem")?.command).toBe(
      "PutItemCommand",
    );
    expect([...names]).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("reflects an operation's input fields + JSON skeleton", async () => {
    const shape = await reflectAction(
      "@aws-sdk/client-dynamodb",
      "PutItemCommand",
    );
    const byName = Object.fromEntries(shape.fields.map((f) => [f.name, f]));
    expect(byName.TableName?.type).toBe("string");
    expect(byName.Item?.type).toBe("map");
    expect(byName.ConditionExpression?.type).toBe("string");
    // skeleton has placeholder values by type
    expect(shape.skeleton).toHaveProperty("TableName", "");
    expect(shape.skeleton.Item).toEqual({});
  });

  it("surfaces binding-trait fields as a best-effort required hint", async () => {
    const shape = await reflectAction(
      "@aws-sdk/client-lambda",
      "InvokeCommand",
    );
    const fn = shape.fields.find((f) => f.name === "FunctionName");
    // FunctionName is an httpLabel -> required hint true
    expect(fn?.required).toBe(true);
    const payload = shape.fields.find((f) => f.name === "Payload");
    expect(payload?.type).toBe("blob");
  });

  it("rejects non-@aws-sdk/client packages", async () => {
    await expect(listActions("lodash" as string)).rejects.toThrow(
      /only @aws-sdk\/client/,
    );
  });
});
