import { Rule } from "eslint";

export const noNonDeterministicOutsideStep: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow non-deterministic operations outside of step functions",
      category: "Possible Errors",
      recommended: true,
    },
    messages: {
      nonDeterministicOutsideStep:
        'Non-deterministic operation "{{operation}}" must be inside a step function for replay consistency.',
      nonDeterministicFunction:
        'Function "{{functionName}}" contains non-deterministic operations and must be called inside a step function.',
    },
    schema: [],
  },
  create(context) {
    const functionNodes = new Map<string, any>();
    const nonDeterministicFunctions = new Set<string>();
    const callsToCheck: Array<{ node: any; functionName: string }> = [];

    function isStepFunction(node: any): boolean {
      let current = node;
      while (current && current.parent) {
        current = current.parent;

        if (
          current.type === "CallExpression" &&
          current.callee?.type === "MemberExpression" &&
          current.callee?.property?.name === "step"
        ) {
          return true;
        }
      }
      return false;
    }

    function isDirectlyNonDeterministic(node: any): string | null {
      if (node.type === "CallExpression") {
        const { callee } = node;

        if (
          callee.type === "MemberExpression" &&
          callee.object?.name === "Math" &&
          callee.property?.name === "random"
        ) {
          return "Math.random()";
        }

        if (
          callee.type === "MemberExpression" &&
          callee.object?.name === "Date" &&
          callee.property?.name === "now"
        ) {
          return "Date.now()";
        }

        if (
          callee.type === "MemberExpression" &&
          callee.object?.name === "performance" &&
          callee.property?.name === "now"
        ) {
          return "performance.now()";
        }

        if (
          callee.type === "MemberExpression" &&
          callee.object?.name === "crypto" &&
          (callee.property?.name === "randomBytes" ||
            callee.property?.name === "getRandomValues")
        ) {
          return `crypto.${callee.property.name}()`;
        }

        if (
          callee.type === "MemberExpression" &&
          (callee.object?.name?.toLowerCase().includes("uuid") ||
            callee.property?.name?.toLowerCase().includes("uuid"))
        ) {
          return "UUID generation";
        }

        if (
          callee.type === "Identifier" &&
          callee.name?.toLowerCase().includes("uuid")
        ) {
          return "UUID generation";
        }
      }

      if (node.type === "NewExpression") {
        if (node.callee?.name === "Date" && node.arguments.length === 0) {
          return "new Date()";
        }
      }

      if (node.type === "MemberExpression") {
        if (node.object?.name === "Math" && node.property?.name === "random") {
          return "Math.random";
        }
        if (node.object?.name === "Date" && node.property?.name === "now") {
          return "Date.now";
        }
        if (
          node.object?.name === "performance" &&
          node.property?.name === "now"
        ) {
          return "performance.now";
        }
      }

      return null;
    }

    function analyzeFunction(functionNode: any): boolean {
      function walkNode(node: any): boolean {
        if (!node) return false;

        const operation = isDirectlyNonDeterministic(node);
        if (operation) return true;

        if (
          node.type === "CallExpression" &&
          node.callee?.type === "Identifier" &&
          nonDeterministicFunctions.has(node.callee.name)
        ) {
          return true;
        }

        for (const key in node) {
          if (key === "parent") continue;
          const child = node[key];
          if (Array.isArray(child)) {
            if (child.some(walkNode)) return true;
          } else if (child && typeof child === "object") {
            if (walkNode(child)) return true;
          }
        }
        return false;
      }

      return walkNode(functionNode.body);
    }

    function getFunctionName(node: any): string | null {
      if (node.type === "FunctionDeclaration" && node.id?.name) {
        return node.id.name;
      }

      if (node.parent?.type === "VariableDeclarator" && node.parent.id?.name) {
        return node.parent.id.name;
      }

      if (
        node.parent?.type === "AssignmentExpression" &&
        node.parent.left?.type === "MemberExpression" &&
        node.parent.left.property?.name
      ) {
        return node.parent.left.property.name;
      }

      return null;
    }

    return {
      "FunctionDeclaration, FunctionExpression, ArrowFunctionExpression"(
        node: any,
      ) {
        const functionName = getFunctionName(node);
        if (functionName) {
          functionNodes.set(functionName, node);
        }
      },

      CallExpression(node: any) {
        if (isStepFunction(node)) return;

        const operation = isDirectlyNonDeterministic(node);
        if (operation) {
          context.report({
            node,
            messageId: "nonDeterministicOutsideStep",
            data: { operation },
          });
          return;
        }

        if (node.callee?.type === "Identifier") {
          const functionName = node.callee.name;
          if (functionNodes.has(functionName)) {
            callsToCheck.push({ node, functionName });
          }
        }
      },

      NewExpression(node: any) {
        if (isStepFunction(node)) return;

        const operation = isDirectlyNonDeterministic(node);
        if (operation) {
          context.report({
            node,
            messageId: "nonDeterministicOutsideStep",
            data: { operation },
          });
        }
      },

      MemberExpression(node: any) {
        if (isStepFunction(node)) return;

        const operation = isDirectlyNonDeterministic(node);
        if (operation) {
          context.report({
            node,
            messageId: "nonDeterministicOutsideStep",
            data: { operation },
          });
        }
      },

      "Program:exit"() {
        // Analyze functions iteratively until no new non-deterministic functions are found
        let changed = true;
        while (changed) {
          changed = false;
          for (const [functionName, functionNode] of functionNodes) {
            if (!nonDeterministicFunctions.has(functionName)) {
              if (analyzeFunction(functionNode)) {
                nonDeterministicFunctions.add(functionName);
                changed = true;
              }
            }
          }
        }

        // Check all deferred function calls
        for (const { node, functionName } of callsToCheck) {
          if (nonDeterministicFunctions.has(functionName)) {
            context.report({
              node,
              messageId: "nonDeterministicFunction",
              data: { functionName },
            });
          }
        }
      },
    };
  },
};
