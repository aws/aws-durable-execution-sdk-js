import { noNonDeterministicOutsideStep } from "./no-non-deterministic-outside-step";

describe("no-non-deterministic-outside-step", () => {
  it("should be defined", () => {
    expect(noNonDeterministicOutsideStep).toBeDefined();
    expect(noNonDeterministicOutsideStep.meta).toBeDefined();
    expect(noNonDeterministicOutsideStep.create).toBeDefined();
  });

  it("should detect Math.random() outside step", () => {
    const mockContext = {
      report: jest.fn(),
    };

    const rule = noNonDeterministicOutsideStep.create(mockContext as any);

    const mockNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: { name: "Math" },
        property: { name: "random" },
      },
      arguments: [],
      parent: null,
    } as any;

    rule.CallExpression!(mockNode);
    expect(mockContext.report).toHaveBeenCalledWith({
      node: mockNode,
      messageId: "nonDeterministicOutsideStep",
      data: { operation: "Math.random()" },
    });
  });

  it("should detect Date.now() outside step", () => {
    const mockContext = {
      report: jest.fn(),
    };

    const rule = noNonDeterministicOutsideStep.create(mockContext as any);

    const mockNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: { name: "Date" },
        property: { name: "now" },
      },
      arguments: [],
      parent: null,
    } as any;

    rule.CallExpression!(mockNode);
    expect(mockContext.report).toHaveBeenCalledWith({
      node: mockNode,
      messageId: "nonDeterministicOutsideStep",
      data: { operation: "Date.now()" },
    });
  });

  it("should detect new Date() outside step", () => {
    const mockContext = {
      report: jest.fn(),
    };

    const rule = noNonDeterministicOutsideStep.create(mockContext as any);

    const mockNode = {
      type: "NewExpression",
      callee: { name: "Date" },
      arguments: [],
      parent: null,
    } as any;

    rule.NewExpression!(mockNode);
    expect(mockContext.report).toHaveBeenCalledWith({
      node: mockNode,
      messageId: "nonDeterministicOutsideStep",
      data: { operation: "new Date()" },
    });
  });

  it("should detect UUID generation outside step", () => {
    const mockContext = {
      report: jest.fn(),
    };

    const rule = noNonDeterministicOutsideStep.create(mockContext as any);

    const mockNode = {
      type: "CallExpression",
      callee: {
        type: "Identifier",
        name: "uuidv4",
      },
      arguments: [],
      parent: null,
    } as any;

    rule.CallExpression!(mockNode);
    expect(mockContext.report).toHaveBeenCalledWith({
      node: mockNode,
      messageId: "nonDeterministicOutsideStep",
      data: { operation: "UUID generation" },
    });
  });

  it("should not report when inside step function", () => {
    const mockContext = {
      report: jest.fn(),
    };

    const rule = noNonDeterministicOutsideStep.create(mockContext as any);

    const stepCallNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: { name: "context" },
        property: { name: "step" },
      },
      arguments: [],
    } as any;

    const randomNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: { name: "Math" },
        property: { name: "random" },
      },
      arguments: [],
      parent: stepCallNode,
    } as any;

    // Visited in traversal order: the step call is entered before its contents.
    rule.CallExpression!(stepCallNode);
    rule.CallExpression!(randomNode);

    expect(mockContext.report).not.toHaveBeenCalled();
  });

  it("should report again once the step function has been exited", () => {
    const mockContext = {
      report: jest.fn(),
    };

    const rule = noNonDeterministicOutsideStep.create(mockContext as any);

    const stepCallNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: { name: "context" },
        property: { name: "step" },
      },
      arguments: [],
    } as any;

    const randomNode = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        object: { name: "Math" },
        property: { name: "random" },
      },
      arguments: [],
    } as any;

    rule.CallExpression!(stepCallNode);
    rule["CallExpression:exit"]!(stepCallNode);
    rule.CallExpression!(randomNode);

    expect(mockContext.report).toHaveBeenCalledWith({
      node: randomNode,
      messageId: "nonDeterministicOutsideStep",
      data: { operation: "Math.random()" },
    });
  });

  it("should not throw at Program:exit when no scope information is available", () => {
    const mockContext = {
      report: jest.fn(),
    };

    const rule = noNonDeterministicOutsideStep.create(mockContext as any);

    rule.CallExpression!({
      type: "CallExpression",
      callee: { type: "Identifier", name: "helper" },
      arguments: [],
    } as any);

    expect(() => rule["Program:exit"]!({} as any)).not.toThrow();
    expect(mockContext.report).not.toHaveBeenCalled();
  });

  it("should detect destructured methods", () => {
    const mockContext = {
      report: jest.fn(),
    };

    const rule = noNonDeterministicOutsideStep.create(mockContext as any);

    // Test accessing Math.random as property
    const mockNode = {
      type: "MemberExpression",
      object: { name: "Math" },
      property: { name: "random" },
      parent: null,
    } as any;

    rule.MemberExpression!(mockNode);
    expect(mockContext.report).toHaveBeenCalledWith({
      node: mockNode,
      messageId: "nonDeterministicOutsideStep",
      data: { operation: "Math.random" },
    });
  });
});
