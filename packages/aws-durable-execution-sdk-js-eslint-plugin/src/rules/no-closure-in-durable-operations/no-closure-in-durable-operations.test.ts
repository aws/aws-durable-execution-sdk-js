import { RuleTester } from "eslint";
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
});

describe("no-closure-in-durable-operations scope resolution", () => {
  /** A durable step callback, with the write/read references it closes over. */
  function fixture() {
    const write = {
      isWrite: () => true,
      resolved: { defs: [{ type: "Variable" }] },
      identifier: { type: "Identifier", name: "counter" },
    };
    const read = {
      isWrite: () => false,
      resolved: { defs: [{ type: "Variable" }] },
      identifier: { type: "Identifier", name: "other" },
    };
    const undeclared = {
      isWrite: () => true,
      resolved: { defs: [] },
      identifier: { type: "Identifier", name: "globalThing" },
    };

    const callback: any = { type: "ArrowFunctionExpression" };
    callback.parent = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        property: { type: "Identifier", name: "step" },
      },
      arguments: [callback],
    };

    return {
      callback,
      scope: { type: "function", through: [write, read, undeclared] },
      write,
    };
  }

  const expectedReport = (write: any) => ({
    node: write.identifier,
    messageId: "closureVariableUsage",
    data: { variableName: "counter" },
  });

  it("resolves scope via context.sourceCode", () => {
    const { callback, scope, write } = fixture();
    const report = jest.fn();

    const rule = noClosureInDurableOperations.create({
      report,
      sourceCode: { scopeManager: { acquire: () => scope } },
    } as any);

    rule.ArrowFunctionExpression!(callback);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expectedReport(write));
  });

  it("falls back to context.getSourceCode() on eslint versions without context.sourceCode", () => {
    const { callback, scope, write } = fixture();
    const report = jest.fn();

    const rule = noClosureInDurableOperations.create({
      report,
      getSourceCode: () => ({ scopeManager: { acquire: () => scope } }),
    } as any);

    rule.ArrowFunctionExpression!(callback);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expectedReport(write));
  });

  it("unwraps nothing extra: acquire returns the function scope directly", () => {
    const { callback, scope, write } = fixture();
    const report = jest.fn();
    const acquire = jest.fn(() => scope);

    const rule = noClosureInDurableOperations.create({
      report,
      sourceCode: { scopeManager: { acquire } },
    } as any);

    rule.ArrowFunctionExpression!(callback);

    // `inner: true` is what makes acquire skip the wrapper scope that a named
    // function expression adds for its own name.
    expect(acquire).toHaveBeenCalledWith(callback, true);
    expect(report).toHaveBeenCalledWith(expectedReport(write));
  });

  it("skips variables declared by the callback itself", () => {
    const { callback, scope } = fixture();
    const report = jest.fn();

    // A named function expression's own name resolves to a definition whose
    // node is the callback.
    scope.through = [
      {
        isWrite: () => true,
        resolved: { defs: [{ type: "FunctionName", node: callback }] },
        identifier: { type: "Identifier", name: "self" },
      },
    ] as any;

    const rule = noClosureInDurableOperations.create({
      report,
      sourceCode: { scopeManager: { acquire: () => scope } },
    } as any);

    rule.ArrowFunctionExpression!(callback);

    expect(report).not.toHaveBeenCalled();
  });

  it("does not throw when no scope information is available", () => {
    const { callback } = fixture();
    const report = jest.fn();

    const rule = noClosureInDurableOperations.create({ report } as any);

    expect(() => rule.ArrowFunctionExpression!(callback)).not.toThrow();
    expect(report).not.toHaveBeenCalled();
  });

  it("ignores callbacks that are not durable operations", () => {
    const { scope } = fixture();
    const report = jest.fn();

    const callback: any = { type: "ArrowFunctionExpression" };
    callback.parent = {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        property: { type: "Identifier", name: "forEach" },
      },
      arguments: [callback],
    };

    const rule = noClosureInDurableOperations.create({
      report,
      sourceCode: { scopeManager: { acquire: () => scope } },
    } as any);

    rule.ArrowFunctionExpression!(callback);

    expect(report).not.toHaveBeenCalled();
  });
});

// The rule reads the scope information ESLint derives while parsing, so it is
// exercised against real source rather than hand-built AST fixtures.
const ruleTester = new RuleTester({
  parser: require.resolve("@typescript-eslint/parser"),
} as any);

const mutationError = (variableName: string) => ({
  messageId: "closureVariableUsage",
  data: { variableName },
});

describe("no-closure-in-durable-operations rule behavior", () => {
  ruleTester.run(
    "no-closure-in-durable-operations",
    noClosureInDurableOperations,
    {
      valid: [
        {
          name: "allows reading a closure variable",
          code: `
            async function handler(event: any, context: DurableContext) {
              let a = 0;
              await context.step(async () => {
                return a;
              });
            }
          `,
        },
        {
          name: "allows mutating a callback parameter",
          code: `
            async function handler(event: any, context: DurableContext) {
              await context.runInChildContext(async (ctx) => {
                ctx = null;
              });
            }
          `,
        },
        {
          name: "allows mutating a variable declared in the callback body",
          code: `
            async function handler(event: any, context: DurableContext) {
              await context.step(async () => {
                let local = 0;
                local = 1;
                return local;
              });
            }
          `,
        },
        {
          name: "allows mutating a variable declared in a nested block of the callback",
          code: `
            async function handler(event: any, context: DurableContext) {
              await context.step(async () => {
                if (true) {
                  let blockVar = 0;
                  blockVar = 1;
                }
              });
            }
          `,
        },
        {
          name: "allows mutating a shadowing variable declared in a nested function",
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 0;
              await context.step(async () => {
                const inner = () => {
                  let counter = 0;
                  counter++;
                  return counter;
                };
                return inner();
              });
            }
          `,
        },
        {
          name: "ignores callbacks passed to non-durable operations",
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 0;
              [1, 2].forEach(() => {
                counter++;
              });
            }
          `,
        },
        {
          name: "allows a named function expression to assign to its own name",
          code: `
            async function handler(event: any, context: DurableContext) {
              await context.step(function self() {
                self = null;
              });
            }
          `,
        },
        {
          name: "allows recursion through a named function expression",
          code: `
            async function handler(event: any, context: DurableContext) {
              await context.step(function fact(n) {
                return n <= 1 ? 1 : n * fact(n - 1);
              });
            }
          `,
        },
        {
          name: "only checks the first function argument of a durable operation",
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 0;
              await context.waitForCallback(
                async (resolve) => resolve(),
                async () => {
                  counter++;
                },
              );
            }
          `,
        },
      ],
      invalid: [
        {
          name: "reports direct assignment",
          code: `
            async function handler(event: any, context: DurableContext) {
              let a = 0;
              await context.step(async () => {
                a = 5;
              });
            }
          `,
          errors: [mutationError("a")],
        },
        {
          name: "reports compound assignment",
          code: `
            async function handler(event: any, context: DurableContext) {
              let a = 0;
              await context.step(async () => {
                a += 1;
              });
            }
          `,
          errors: [mutationError("a")],
        },
        {
          name: "reports increment",
          code: `
            async function handler(event: any, context: DurableContext) {
              let a = 0;
              await context.step(async () => {
                a++;
              });
            }
          `,
          errors: [mutationError("a")],
        },
        {
          name: "reports pre-increment",
          code: `
            async function handler(event: any, context: DurableContext) {
              let a = 0;
              await context.step(async () => {
                ++a;
              });
            }
          `,
          errors: [mutationError("a")],
        },
        {
          name: "reports decrement",
          code: `
            async function handler(event: any, context: DurableContext) {
              let a = 0;
              await context.step(async () => {
                a--;
              });
            }
          `,
          errors: [mutationError("a")],
        },
        {
          name: "reports mutation in a runInChildContext callback",
          code: `
            async function handler(event: any, context: DurableContext) {
              let a = 0;
              await context.runInChildContext(async (ctx) => {
                a = 1;
              });
            }
          `,
          errors: [mutationError("a")],
        },
        {
          name: "reports mutation in a waitForCondition callback",
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 0;
              await context.waitForCondition(async () => {
                counter++;
              });
            }
          `,
          errors: [mutationError("counter")],
        },
        {
          name: "reports mutation in a waitForCallback callback",
          code: `
            async function handler(event: any, context: DurableContext) {
              let result = null;
              await context.waitForCallback(async (resolve) => {
                result = "done";
              });
            }
          `,
          errors: [mutationError("result")],
        },
        {
          name: "reports mutation when the callback is the 1st argument",
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 0;
              await context.step(async () => {
                counter++;
              });
            }
          `,
          errors: [mutationError("counter")],
        },
        {
          name: "reports mutation when the callback is the 2nd argument",
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 0;
              await context.step("stepName", async () => {
                counter++;
              });
            }
          `,
          errors: [mutationError("counter")],
        },
        {
          name: "reports mutation when the callback is the 2nd argument with a config 3rd",
          code: `
            async function handler(event: any, context: DurableContext) {
              let counter = 0;
              await context.step("stepName", async () => {
                counter++;
              }, { retry: 3 });
            }
          `,
          errors: [mutationError("counter")],
        },
        {
          name: "reports mutation of a destructured outer declaration",
          code: `
            async function handler(event: any, context: DurableContext) {
              let { total } = event;
              await context.step(async () => {
                total += 1;
              });
            }
          `,
          errors: [mutationError("total")],
        },
        {
          name: "reports mutation of a variable declared in an outer nested block",
          code: `
            async function handler(event: any, context: DurableContext) {
              if (event.flag) {
                let counter = 0;
                await context.step(async () => {
                  counter++;
                });
              }
            }
          `,
          errors: [mutationError("counter")],
        },
        {
          name: "reports mutation of a module-scope variable",
          code: `
            let counter = 0;
            async function handler(event: any, context: DurableContext) {
              await context.step(async () => {
                counter++;
              });
            }
          `,
          errors: [mutationError("counter")],
        },
        {
          name: "reports mutation of an exported module-scope variable",
          code: `
            export let count = 0;
            async function handler(event: any, context: DurableContext) {
              await context.step(async () => {
                count += 1;
              });
            }
          `,
          errors: [mutationError("count")],
        },
        {
          name: "reports mutation of a catch binding",
          code: `
            async function handler(event: any, context: DurableContext) {
              try {
                doThing();
              } catch (e) {
                await context.step(async () => {
                  e = null;
                });
              }
            }
          `,
          errors: [mutationError("e")],
        },
        {
          name: "reports array destructuring assignment targets",
          code: `
            async function handler(event: any, context: DurableContext) {
              let a = 0;
              await context.step(async () => {
                [a] = [1];
              });
            }
          `,
          errors: [mutationError("a")],
        },
        {
          name: "reports object destructuring assignment targets",
          code: `
            async function handler(event: any, context: DurableContext) {
              let a = 0;
              await context.step(async () => {
                ({ a } = event);
              });
            }
          `,
          errors: [mutationError("a")],
        },
        {
          name: "reports for-of assignment targets",
          code: `
            async function handler(event: any, context: DurableContext) {
              let a = 0;
              await context.step(async () => {
                for (a of event.items) {
                  use(a);
                }
              });
            }
          `,
          errors: [mutationError("a")],
        },
      ],
    },
  );
});
