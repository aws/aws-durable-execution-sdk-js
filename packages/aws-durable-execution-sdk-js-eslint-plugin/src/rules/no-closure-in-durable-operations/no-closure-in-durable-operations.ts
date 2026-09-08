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
 *
 * Implementation note:
 * This rule relies on the scope information ESLint already computes while parsing
 * rather than re-walking the AST. For a durable callback's function scope,
 * `scope.through` is exactly the set of references that could not be resolved
 * inside the callback, i.e. the closure references. Filtering those to writes
 * yields the violations directly, in O(closure references) instead of the
 * O(assignments x subtree size) cost of a manual traversal.
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

    // `context.sourceCode` is preferred and is the only form available in
    // ESLint v10, where `context.getSourceCode()` was removed (see #472). The
    // optional fallback is kept because the plugin supports eslint >=8.0.0 and
    // `context.sourceCode` only landed in 8.40. Because the property is checked
    // first and the call is optional, neither branch can throw at startup the
    // way the unconditional call removed in #472 did.
    const sourceCode: any =
      (context as any).sourceCode ?? (context as any).getSourceCode?.();

    /**
     * Checks if a node is a durable operation call.
     *
     * Example: context.step(...) or ctx.runInChildContext(...)
     */
    function isDurableOperationCall(node: any): boolean {
      return (
        node?.type === "CallExpression" &&
        node.callee?.type === "MemberExpression" &&
        node.callee.property?.type === "Identifier" &&
        durableOperations.has(node.callee.property.name)
      );
    }

    /**
     * Checks whether the given function node is the callback of a durable operation.
     *
     * The callback is the first function-valued argument, which covers every
     * overload:
     *   context.step(fn)
     *   context.step("name", fn)
     *   context.step("name", fn, config)
     */
    function isDurableCallback(fn: any): boolean {
      const call = fn.parent;
      if (!isDurableOperationCall(call)) return false;

      const callback = call.arguments.find(
        (arg: any) =>
          arg.type === "ArrowFunctionExpression" ||
          arg.type === "FunctionExpression",
      );
      return callback === fn;
    }

    /**
     * Resolves the scope ESLint created for a function node.
     *
     * `scopeManager.acquire` is used rather than `sourceCode.getScope(node)`
     * because it is available across the whole supported eslint range
     * (`getScope` only landed in 8.37) and needs no version fallback.
     *
     * A named function expression has two scopes, the wrapper holding its own
     * name and the function scope; `acquire` filters the wrapper out, so this
     * always returns the function scope.
     */
    function getFunctionScope(fn: any): any {
      return sourceCode?.scopeManager?.acquire(fn, true) ?? null;
    }

    /**
     * Reports every write to a variable that is declared outside the callback.
     *
     * References reach `scope.through` only if they could not be resolved within
     * the callback, so callback parameters and callback-local declarations
     * (including ones in nested blocks) are excluded automatically, and
     * shadowing is handled correctly. Variables with no declaration (implicit
     * or environment globals) are skipped.
     */
    function checkDurableCallback(fn: any) {
      if (!isDurableCallback(fn)) return;

      const scope = getFunctionScope(fn);
      if (!scope) return;

      for (const reference of scope.through) {
        if (!reference.isWrite()) continue;

        const variable = reference.resolved;
        if (!variable || variable.defs.length === 0) continue;

        // A named function expression's own name is bound in a wrapper scope
        // outside the function scope, so writing to it escapes into
        // `scope.through`. It is not outer state: the assignment is a no-op in
        // sloppy mode and a TypeError in strict mode, and it cannot cause
        // replay divergence.
        if (variable.defs.some((def: any) => def.node === fn)) continue;

        context.report({
          node: reference.identifier,
          messageId: "closureVariableUsage",
          data: {
            variableName: reference.identifier.name,
          },
        });
      }
    }

    return {
      ArrowFunctionExpression: checkDurableCallback,
      FunctionExpression: checkDurableCallback,
    };
  },
};
