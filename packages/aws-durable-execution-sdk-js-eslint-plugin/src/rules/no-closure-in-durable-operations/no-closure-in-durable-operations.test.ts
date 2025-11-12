import { noClosureInDurableOperations } from "./no-closure-in-durable-operations";

describe("no-closure-in-durable-operations", () => {
  it("should be defined", () => {
    expect(noClosureInDurableOperations).toBeDefined();
    expect(noClosureInDurableOperations.meta).toBeDefined();
    expect(noClosureInDurableOperations.create).toBeDefined();
  });

  it("should have correct meta information", () => {
    const meta = noClosureInDurableOperations.meta!;
    expect(meta.type).toBe("problem");
    expect(meta.docs?.description).toContain("closure variables");
    expect(meta.messages?.closureVariableUsage).toBeDefined();
  });

  describe("should detect mutations", () => {
    it("should detect direct assignment (a = value)", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "a" };
      const assignment: any = {
        type: "AssignmentExpression",
        operator: "=",
        left: identifier,
      };
      identifier.parent = assignment;

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [{ type: "ExpressionStatement", expression: assignment }],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "a" },
                },
              ],
            },
          ],
        },
      };

      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "step" },
        },
        arguments: [stepCallback],
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;
      assignment.parent = stepCallback.body.body[0];

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).toHaveBeenCalledWith({
        node: identifier,
        messageId: "closureVariableUsage",
        data: { variableName: "a" },
      });
    });

    it("should detect compound assignment (a += 1)", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "a" };
      const assignment: any = {
        type: "AssignmentExpression",
        operator: "+=",
        left: identifier,
      };
      identifier.parent = assignment;

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [{ type: "ExpressionStatement", expression: assignment }],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "a" },
                },
              ],
            },
          ],
        },
      };

      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "step" },
        },
        arguments: [stepCallback],
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).toHaveBeenCalled();
    });

    it("should detect increment (a++)", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "a" };
      const updateExpr: any = {
        type: "UpdateExpression",
        operator: "++",
        argument: identifier,
        prefix: false,
      };
      identifier.parent = updateExpr;

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [{ type: "ExpressionStatement", expression: updateExpr }],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "a" },
                },
              ],
            },
          ],
        },
      };

      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "step" },
        },
        arguments: [stepCallback],
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).toHaveBeenCalled();
    });

    it("should detect pre-increment (++a)", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "a" };
      const updateExpr: any = {
        type: "UpdateExpression",
        operator: "++",
        argument: identifier,
        prefix: true,
      };
      identifier.parent = updateExpr;

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [{ type: "ExpressionStatement", expression: updateExpr }],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "a" },
                },
              ],
            },
          ],
        },
      };

      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "step" },
        },
        arguments: [stepCallback],
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).toHaveBeenCalled();
    });

    it("should detect decrement (a--)", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "a" };
      const updateExpr: any = {
        type: "UpdateExpression",
        operator: "--",
        argument: identifier,
        prefix: false,
      };
      identifier.parent = updateExpr;

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [{ type: "ExpressionStatement", expression: updateExpr }],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "a" },
                },
              ],
            },
          ],
        },
      };

      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "step" },
        },
        arguments: [stepCallback],
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).toHaveBeenCalled();
    });
  });

  describe("should allow reads", () => {
    it("should allow reading closure variable", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "a" };
      const returnStmt: any = {
        type: "ReturnStatement",
        argument: identifier,
      };
      identifier.parent = returnStmt;

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [returnStmt],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "a" },
                },
              ],
            },
          ],
        },
      };

      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "step" },
        },
        arguments: [stepCallback],
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).not.toHaveBeenCalled();
    });
  });

  describe("should handle variable scopes", () => {
    it("should not report if variable is declared in callback params", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "ctx" };
      const assignment: any = {
        type: "AssignmentExpression",
        left: identifier,
      };
      identifier.parent = assignment;

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [{ type: "Identifier", name: "ctx" }],
        body: {
          type: "BlockStatement",
          body: [{ type: "ExpressionStatement", expression: assignment }],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: { type: "BlockStatement", body: [] },
      };

      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "runInChildContext" },
        },
        arguments: [stepCallback],
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).not.toHaveBeenCalled();
    });

    it("should not report if variable is declared in callback body", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "local" };
      const assignment: any = {
        type: "AssignmentExpression",
        left: identifier,
      };
      identifier.parent = assignment;

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "local" },
                },
              ],
            },
            { type: "ExpressionStatement", expression: assignment },
          ],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: { type: "BlockStatement", body: [] },
      };

      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "step" },
        },
        arguments: [stepCallback],
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).not.toHaveBeenCalled();
    });

    it("should not report if variable is declared in nested block within callback", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "blockVar" };
      const assignment: any = {
        type: "AssignmentExpression",
        left: identifier,
      };
      identifier.parent = assignment;

      const ifBlock: any = {
        type: "IfStatement",
        consequent: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "blockVar" },
                },
              ],
            },
          ],
        },
      };

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            ifBlock,
            { type: "ExpressionStatement", expression: assignment },
          ],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: { type: "BlockStatement", body: [] },
      };

      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "step" },
        },
        arguments: [stepCallback],
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).not.toHaveBeenCalled();
    });
  });

  describe("should work with runInChildContext", () => {
    it("should detect mutation in runInChildContext callback", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "a" };
      const assignment: any = {
        type: "AssignmentExpression",
        left: identifier,
      };
      identifier.parent = assignment;

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [{ type: "Identifier", name: "ctx" }],
        body: {
          type: "BlockStatement",
          body: [{ type: "ExpressionStatement", expression: assignment }],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "a" },
                },
              ],
            },
          ],
        },
      };

      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "runInChildContext" },
        },
        arguments: [stepCallback],
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).toHaveBeenCalled();
    });
  });

  describe("should work with waitForCondition", () => {
    it("should detect mutation in waitForCondition callback", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "counter" };
      const updateExpr: any = {
        type: "UpdateExpression",
        operator: "++",
        argument: identifier,
      };
      identifier.parent = updateExpr;

      const conditionCallback: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [{ type: "ExpressionStatement", expression: updateExpr }],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "counter" },
                },
              ],
            },
          ],
        },
      };

      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "waitForCondition" },
        },
        arguments: [conditionCallback],
        parent: outerFunction,
      };

      conditionCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).toHaveBeenCalled();
    });
  });

  describe("should work with waitForCallback", () => {
    it("should detect mutation in waitForCallback callback", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "result" };
      const assignment: any = {
        type: "AssignmentExpression",
        left: identifier,
      };
      identifier.parent = assignment;

      const callbackFn: any = {
        type: "ArrowFunctionExpression",
        params: [{ type: "Identifier", name: "resolve" }],
        body: {
          type: "BlockStatement",
          body: [{ type: "ExpressionStatement", expression: assignment }],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "result" },
                },
              ],
            },
          ],
        },
      };

      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "waitForCallback" },
        },
        arguments: [callbackFn],
        parent: outerFunction,
      };

      callbackFn.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).toHaveBeenCalled();
    });
  });

  describe("should handle function parameter overloads", () => {
    it("should detect mutation when function is 1st parameter (no name)", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "counter" };
      const updateExpr: any = {
        type: "UpdateExpression",
        operator: "++",
        argument: identifier,
      };
      identifier.parent = updateExpr;

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [{ type: "ExpressionStatement", expression: updateExpr }],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "counter" },
                },
              ],
            },
          ],
        },
      };

      // context.step(async () => { counter++; })
      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "step" },
        },
        arguments: [stepCallback], // Function as 1st argument
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).toHaveBeenCalled();
    });

    it("should detect mutation when function is 2nd parameter (with name)", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "counter" };
      const updateExpr: any = {
        type: "UpdateExpression",
        operator: "++",
        argument: identifier,
      };
      identifier.parent = updateExpr;

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [{ type: "ExpressionStatement", expression: updateExpr }],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "counter" },
                },
              ],
            },
          ],
        },
      };

      // context.step("stepName", async () => { counter++; })
      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "step" },
        },
        arguments: [
          { type: "Literal", value: "stepName" }, // Name as 1st argument
          stepCallback, // Function as 2nd argument
        ],
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).toHaveBeenCalled();
    });

    it("should detect mutation when function is 2nd parameter with config as 3rd", () => {
      const mockContext = {
        report: jest.fn(),
        getSourceCode: jest.fn(() => ({ ast: { tokens: [] } })),
      };

      const rule = noClosureInDurableOperations.create(mockContext as any);

      const identifier: any = { type: "Identifier", name: "counter" };
      const updateExpr: any = {
        type: "UpdateExpression",
        operator: "++",
        argument: identifier,
      };
      identifier.parent = updateExpr;

      const stepCallback: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [{ type: "ExpressionStatement", expression: updateExpr }],
        },
      };

      const outerFunction: any = {
        type: "ArrowFunctionExpression",
        params: [],
        body: {
          type: "BlockStatement",
          body: [
            {
              type: "VariableDeclaration",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "counter" },
                },
              ],
            },
          ],
        },
      };

      // context.step("stepName", async () => { counter++; }, { retry: 3 })
      const callExpression: any = {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          property: { type: "Identifier", name: "step" },
        },
        arguments: [
          { type: "Literal", value: "stepName" },
          stepCallback,
          { type: "ObjectExpression", properties: [] }, // Config object
        ],
        parent: outerFunction,
      };

      stepCallback.parent = callExpression;

      rule.CallExpression?.(callExpression);

      expect(mockContext.report).toHaveBeenCalled();
    });
  });
});
