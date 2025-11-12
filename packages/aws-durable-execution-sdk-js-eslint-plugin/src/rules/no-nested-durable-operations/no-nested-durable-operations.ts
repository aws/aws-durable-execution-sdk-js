import { Rule } from "eslint";

export const noNestedDurableOperations: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow using the same context object inside its own durable operation",
      category: "Possible Errors",
      recommended: true,
    },
    messages: {
      sameContextUsage:
        'Cannot use the same context object "{{contextName}}" inside its own operation. Use runInChildContext for nested operations.',
    },
    schema: [],
  },
  create(context) {
    const durableOperations = new Set([
      "step",
      "wait",
      "waitForCallback",
      "waitForCondition",
      "parallel",
      "map",
      "runInChildContext",
    ]);

    // Track context variables by name and their declaration node
    let contextStack: { name: string; declarationNode: any }[] = [];

    function isDurableOperation(
      node: any,
    ): { operation: string; contextName: string; contextNode: any } | null {
      if (
        node.callee &&
        node.callee.type === "MemberExpression" &&
        node.callee.property &&
        node.callee.property.type === "Identifier" &&
        durableOperations.has(node.callee.property.name) &&
        node.callee.object &&
        node.callee.object.type === "Identifier"
      ) {
        return {
          operation: node.callee.property.name,
          contextName: node.callee.object.name,
          contextNode: node.callee.object,
        };
      }
      return null;
    }

    function findVariableDeclaration(node: any, name: string): any {
      // Simple heuristic: find the closest function parameter or variable declaration
      let current = node;
      while (current && current.parent) {
        current = current.parent;

        // Check if this is a function with parameters
        if (
          current.type === "ArrowFunctionExpression" ||
          current.type === "FunctionExpression"
        ) {
          const param = current.params?.find((p: any) => p.name === name);
          if (param) return param;
        }

        // Check for variable declarations
        if (
          current.type === "VariableDeclarator" &&
          current.id?.name === name
        ) {
          return current.id;
        }
      }
      return null;
    }

    return {
      CallExpression(node: any) {
        const durableOp = isDurableOperation(node);

        if (durableOp) {
          const { contextName, contextNode } = durableOp;

          // Find the declaration of this context variable
          const declaration = findVariableDeclaration(contextNode, contextName);

          // Check if we're using the same variable declaration that's already on the stack
          const isAlreadyInStack = contextStack.some(
            (stackItem) =>
              stackItem.declarationNode === declaration && declaration !== null,
          );

          if (isAlreadyInStack) {
            context.report({
              node,
              messageId: "sameContextUsage",
              data: {
                contextName,
              },
            });
          }

          // Add this context to the stack
          contextStack.push({
            name: contextName,
            declarationNode: declaration,
          });
        }
      },
      "CallExpression:exit"(node: any) {
        const durableOp = isDurableOperation(node);
        if (durableOp && contextStack.length > 0) {
          contextStack.pop();
        }
      },
    };
  },
};
