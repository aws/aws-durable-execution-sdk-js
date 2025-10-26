import { noNestedDurableOperations } from "../no-nested-durable-operations";

describe("no-nested-durable-operations", () => {
  it("should be defined", () => {
    expect(noNestedDurableOperations).toBeDefined();
    expect(noNestedDurableOperations.meta).toBeDefined();
    expect(noNestedDurableOperations.create).toBeDefined();
  });

  it("should have correct meta information", () => {
    const meta = noNestedDurableOperations.meta!;
    expect(meta.type).toBe("problem");
    expect(meta.docs?.description).toContain("same context object");
    expect(meta.messages?.sameContextUsage).toBeDefined();
  });

  it("should create rule function", () => {
    const mockContext = {
      report: jest.fn(),
    };

    const rule = noNestedDurableOperations.create(mockContext as any);
    expect(rule).toBeDefined();
    expect(rule.CallExpression).toBeDefined();
    expect(rule["CallExpression:exit"]).toBeDefined();
  });

  it("should handle variable shadowing correctly", () => {
    const mockContext = {
      report: jest.fn(),
    };

    const rule = noNestedDurableOperations.create(mockContext as any);

    // Create mock nodes with proper parent structure for shadowing
    const outerParam = { type: "Identifier", name: "context" };
    const innerParam = { type: "Identifier", name: "context" };

    const outerFunction: any = {
      type: "ArrowFunctionExpression",
      params: [outerParam],
      parent: null,
    };

    const innerFunction: any = {
      type: "ArrowFunctionExpression",
      params: [innerParam],
      parent: outerFunction,
    };

    const outerContextNode: any = {
      type: "Identifier",
      name: "context",
      parent: outerFunction,
    };

    const innerContextNode: any = {
      type: "Identifier",
      name: "context",
      parent: innerFunction,
    };

    const outerStepNode: any = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        property: { type: "Identifier", name: "step" },
        object: outerContextNode,
      },
      arguments: [],
      parent: outerFunction,
    };

    const innerStepNode: any = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        property: { type: "Identifier", name: "step" },
        object: innerContextNode,
      },
      arguments: [],
      parent: innerFunction,
    };

    // Set up parent relationships
    outerContextNode.parent = outerStepNode;
    innerContextNode.parent = innerStepNode;

    // First call with outer context
    rule.CallExpression!(outerStepNode);
    expect(mockContext.report).not.toHaveBeenCalled();

    // Second call with shadowed inner context (different declaration)
    rule.CallExpression!(innerStepNode);
    expect(mockContext.report).not.toHaveBeenCalled();
  });

  it("should detect same context reuse", () => {
    const mockContext = {
      report: jest.fn(),
    };

    const rule = noNestedDurableOperations.create(mockContext as any);

    // Create mock nodes with same declaration
    const param = { type: "Identifier", name: "context" };
    const func: any = {
      type: "ArrowFunctionExpression",
      params: [param],
      parent: null,
    };

    const contextNode: any = {
      type: "Identifier",
      name: "context",
      parent: func,
    };

    const stepNode: any = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        property: { type: "Identifier", name: "step" },
        object: contextNode,
      },
      arguments: [],
      parent: func,
    };

    contextNode.parent = stepNode;

    // First call - should not report
    rule.CallExpression!(stepNode);
    expect(mockContext.report).not.toHaveBeenCalled();

    // Second call with same declaration - should report
    rule.CallExpression!(stepNode);
    expect(mockContext.report).toHaveBeenCalledWith({
      node: stepNode,
      messageId: "sameContextUsage",
      data: { contextName: "context" },
    });
  });
});
