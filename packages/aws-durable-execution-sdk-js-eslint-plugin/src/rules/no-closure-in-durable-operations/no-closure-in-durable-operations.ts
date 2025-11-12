import { Rule } from "eslint";

/**
 * ESLint rule to prevent modifying closure variables inside durable operations.
 *
 * Why this matters:
 * During replay, durable functions skip already-executed steps. If a closure variable
 * is modified inside a step, the modification won't occur during replay, causing
 * different outcomes between initial execution and replay.
 *
 * Example of problematic code:
 *   let counter = 0;
 *   await context.step(async () => {
 *     counter++;  // ❌ This won't execute during replay!
 *   });
 *
 * Example of safe code:
 *   let counter = 0;
 *   await context.step(async () => {
 *     return counter + 1;  // ✅ Reading is safe
 *   });
 */
export const noClosureInDurableOperations: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow modifying closure variables inside durable operations",
      category: "Possible Errors",
      recommended: true,
    },
    messages: {
      closureVariableUsage:
        'Variable "{{variableName}}" from outer scope should not be modified inside durable operations. It may cause inconsistent behavior during replay.',
    },
    schema: [],
  },
  create(context) {
    // Durable operations that accept callbacks where mutations could cause issues
    const durableOperations = new Set([
      "step",
      "runInChildContext",
      "waitForCondition",
      "waitForCallback",
    ]);

    /**
     * Checks if a node is a durable operation call.
     *
     * Example: context.step(...) or ctx.runInChildContext(...)
     *
     * @param node - AST node to check
     * @returns true if node is a durable operation call
     */
    function isDurableOperation(node: any): boolean {
      return (
        node.type === "CallExpression" &&
        node.callee?.type === "MemberExpression" &&
        node.callee.property?.type === "Identifier" &&
        durableOperations.has(node.callee.property.name)
      );
    }

    /**
     * Extracts the callback function from a durable operation call.
     *
     * Example:
     *   context.step(async () => { ... })
     *                ^^^^^^^^^^^^^^^^^ returns this function
     *
     * @param node - CallExpression node
     * @returns The callback function node, or null if not found
     */
    function getCallbackFunction(node: any): any {
      if (!isDurableOperation(node)) return null;

      const args = node.arguments;
      for (const arg of args) {
        if (
          arg.type === "ArrowFunctionExpression" ||
          arg.type === "FunctionExpression"
        ) {
          return arg;
        }
      }
      return null;
    }

    /**
     * Collects all variable names declared within a scope (including nested scopes).
     *
     * This includes:
     * - Function parameters: async (ctx) => { ... }
     * - Top-level declarations: const x = 1;
     * - Nested block declarations: if (true) { let y = 2; }
     * - Loop variables: for (let i = 0; ...)
     *
     * Example:
     *   async (ctx) => {
     *     const x = 1;
     *     if (true) {
     *       let y = 2;
     *     }
     *   }
     *   Returns: Set(['ctx', 'x', 'y'])
     *
     * @param scopeNode - Function or block node to analyze
     * @returns Set of variable names declared in this scope
     */
    function getVariablesDeclaredInScope(scopeNode: any): Set<string> {
      const declared = new Set<string>();

      // Add function parameters
      // Example: async (ctx, resolve) => { ... }
      //                 ^^^  ^^^^^^^
      if (scopeNode.params) {
        scopeNode.params.forEach((param: any) => {
          if (param.type === "Identifier") {
            declared.add(param.name);
          }
        });
      }

      // Recursively walk the entire callback body to find all variable declarations
      // This catches variables in nested blocks, loops, try-catch, etc.
      function walkForDeclarations(node: any) {
        if (!node) return;

        // Found a variable declaration
        // Example: const x = 1; or let y = 2;
        if (node.type === "VariableDeclaration") {
          node.declarations.forEach((decl: any) => {
            if (decl.id?.type === "Identifier") {
              declared.add(decl.id.name);
            }
          });
        }

        // Walk all child nodes to find nested declarations
        for (const key in node) {
          if (key === "parent") continue; // Skip parent references to avoid cycles
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach(walkForDeclarations);
          } else if (child && typeof child === "object") {
            walkForDeclarations(child);
          }
        }
      }

      if (scopeNode.body) {
        walkForDeclarations(scopeNode.body);
      }

      return declared;
    }

    /**
     * Finds all variables declared in outer (parent) scopes.
     *
     * Walks up the AST tree to find variables declared in enclosing functions.
     *
     * Example:
     *   async (event, context) => {
     *     let counter = 0;
     *     await context.step(async () => {
     *       // From here, outer variables are: event, context, counter
     *     });
     *   }
     *
     * @param callbackNode - The callback function node
     * @returns Set of variable names from outer scopes
     */
    function findOuterScopeVariables(callbackNode: any): Set<string> {
      const outerVars = new Set<string>();
      let current = callbackNode.parent;

      // Walk up the tree until we reach the root
      while (current) {
        // Check if this is a function scope
        if (
          current.type === "ArrowFunctionExpression" ||
          current.type === "FunctionExpression" ||
          current.type === "FunctionDeclaration"
        ) {
          // Add function parameters
          // Example: async (event, context) => { ... }
          if (current.params) {
            current.params.forEach((param: any) => {
              if (param.type === "Identifier") {
                outerVars.add(param.name);
              }
            });
          }

          // Add variables declared in this function's body
          // Example: const result = await fetch();
          if (current.body?.type === "BlockStatement") {
            const body = current.body.body;
            for (const stmt of body) {
              if (stmt.type === "VariableDeclaration") {
                stmt.declarations.forEach((decl: any) => {
                  if (decl.id?.type === "Identifier") {
                    outerVars.add(decl.id.name);
                  }
                });
              }
            }
          }
        }
        current = current.parent;
      }

      return outerVars;
    }

    /**
     * Checks if an identifier is being assigned/mutated.
     *
     * Detects:
     * - Direct assignment: a = 5
     * - Compound assignment: a += 1, a -= 1, a *= 2, etc.
     * - Increment/decrement: a++, ++a, a--, --a
     *
     * Does NOT flag reads:
     * - return a;
     * - const b = a + 1;
     * - console.log(a);
     *
     * @param node - Identifier node to check
     * @returns true if the identifier is being mutated
     */
    function isAssignment(node: any): boolean {
      const parent = node.parent;
      if (!parent) return false;

      // Check for assignment expressions
      // Examples: a = 5, a += 1, a -= 2, a *= 3
      if (parent.type === "AssignmentExpression" && parent.left === node) {
        return true;
      }

      // Check for update expressions
      // Examples: a++, ++a, a--, --a
      if (parent.type === "UpdateExpression" && parent.argument === node) {
        return true;
      }

      return false;
    }

    /**
     * Checks if an identifier usage is a problematic closure mutation.
     *
     * Reports an error if:
     * 1. The identifier is being assigned/mutated (not just read)
     * 2. The variable is NOT declared in the callback itself
     * 3. The variable IS declared in an outer scope
     *
     * Example that triggers error:
     *   let counter = 0;  // Outer scope
     *   await context.step(async () => {
     *     counter++;  // ❌ Mutating outer variable
     *   });
     *
     * Example that's allowed:
     *   let counter = 0;  // Outer scope
     *   await context.step(async () => {
     *     return counter + 1;  // ✅ Just reading
     *   });
     *
     * @param node - Identifier node to check
     * @param callback - The callback function containing this identifier
     */
    function checkIdentifierUsage(node: any, callback: any) {
      const declaredInCallback = getVariablesDeclaredInScope(callback);
      const outerVars = findOuterScopeVariables(callback);

      if (
        node.type === "Identifier" &&
        !declaredInCallback.has(node.name) && // Not declared in callback
        outerVars.has(node.name) && // Is from outer scope
        isAssignment(node) // Is being mutated
      ) {
        context.report({
          node,
          messageId: "closureVariableUsage",
          data: {
            variableName: node.name,
          },
        });
      }
    }

    // Main rule logic: analyze all function calls
    return {
      CallExpression(node: any) {
        // Only check durable operations
        if (!isDurableOperation(node)) return;

        // Get the callback function passed to the durable operation
        const callback = getCallbackFunction(node);
        if (!callback) return;

        // Get source code for AST traversal
        const sourceCode = context.getSourceCode();

        /**
         * Recursively walks the callback's AST to find all identifier usages.
         *
         * For each identifier found, checks if it's a problematic closure mutation.
         */
        function walkNode(n: any, cb: any) {
          if (!n) return;

          // Check assignments and updates directly to avoid duplicate reports
          if (
            n.type === "AssignmentExpression" &&
            n.left?.type === "Identifier"
          ) {
            checkIdentifierUsage(n.left, cb);
          } else if (
            n.type === "UpdateExpression" &&
            n.argument?.type === "Identifier"
          ) {
            checkIdentifierUsage(n.argument, cb);
          }

          // Recursively walk all child nodes
          for (const key in n) {
            if (key === "parent") continue; // Skip parent to avoid cycles
            const child = n[key];
            if (Array.isArray(child)) {
              child.forEach((c) => walkNode(c, cb));
            } else if (child && typeof child === "object") {
              walkNode(child, cb);
            }
          }
        }

        // Start walking from the callback body
        walkNode(callback.body, callback);
      },
    };
  },
};
