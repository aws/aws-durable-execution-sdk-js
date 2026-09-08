import { Rule } from "eslint";

/**
 * ESLint rule to keep non-deterministic operations inside steps.
 *
 * Implementation notes:
 * - "Am I inside a step?" is tracked with a depth counter maintained by the
 *   enter/exit visitors instead of walking every node's ancestors, which turns
 *   an O(nodes x depth) check into O(1).
 * - Transitive non-determinism across functions is resolved by building a caller
 *   graph during the single traversal ESLint already performs and then
 *   propagating over it with a worklist at `Program:exit`. This replaces a
 *   fixpoint loop that re-walked every function body on every pass, reducing
 *   O(functions x total size) to O(functions + calls). Only the innermost
 *   enclosing function is recorded per call site; outer functions are reached
 *   through the nesting tree during propagation, so nothing is per-depth.
 * - The graph is keyed on the function nodes that callees resolve to via scope
 *   analysis, not on identifier names. Keying on names would let same-named
 *   functions in unrelated scopes taint each other.
 */
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
    // `context.sourceCode` is preferred and is the only form available in
    // ESLint v10, where `context.getSourceCode()` was removed (see #472). The
    // optional fallback is kept because the plugin supports eslint >=8.0.0 and
    // `context.sourceCode` only landed in 8.40. Because the property is checked
    // first and the call is optional, neither branch can throw at startup the
    // way the unconditional call removed in #472 did.
    const sourceCode: any =
      (context as any).sourceCode ?? (context as any).getSourceCode?.();

    /** Function nodes known to contain non-deterministic operations. */
    const nonDeterministicFunctions = new Set<any>();

    /** Enclosing function nodes at the current traversal point. */
    const functionStack: any[] = [];

    /** Function node -> the function that lexically encloses it. */
    const enclosingFunction = new Map<any, any>();

    /**
     * Recorded call sites: (callee identifier, innermost enclosing function).
     * Callees are resolved to declarations at `Program:exit`, once scope
     * analysis for the whole file can be consulted in one pass.
     */
    const callEdges: Array<{ callee: any; enclosing: any }> = [];

    /** Calls outside a step, checked once the caller graph is complete. */
    const callsToCheck: Array<{ node: any; callee: any }> = [];

    /** Number of enclosing step calls; > 0 means "inside a step". */
    let stepDepth = 0;

    function isFunctionNode(node: any): boolean {
      return (
        node?.type === "FunctionDeclaration" ||
        node?.type === "FunctionExpression" ||
        node?.type === "ArrowFunctionExpression"
      );
    }

    function isStepCall(node: any): boolean {
      return (
        node.type === "CallExpression" &&
        node.callee?.type === "MemberExpression" &&
        node.callee?.property?.name === "step"
      );
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

    /**
     * Marks the innermost enclosing function as non-deterministic.
     *
     * Outer functions are reached through the nesting tree during propagation.
     * This happens regardless of step depth: a function that wraps a step
     * containing `Date.now()` still cannot be safely called outside a step.
     */
    function markEnclosingFunction() {
      const fn = functionStack[functionStack.length - 1];
      if (fn) nonDeterministicFunctions.add(fn);
    }

    /** Reports a direct violation, and attributes it to the enclosing function. */
    function checkNode(node: any, insideStep: boolean): boolean {
      const operation = isDirectlyNonDeterministic(node);
      if (!operation) return false;

      markEnclosingFunction();

      if (!insideStep) {
        context.report({
          node,
          messageId: "nonDeterministicOutsideStep",
          data: { operation },
        });
      }
      return true;
    }

    /**
     * Maps the recorded callee identifiers to their variables in one pass over
     * the scope tree. Only the identifiers actually referenced by the caller
     * graph are retained, so memory stays proportional to the call sites rather
     * than to every reference in the file.
     */
    function resolveCallees(wanted: Set<any>): Map<any, any> {
      const resolved = new Map<any, any>();
      const rootScope = sourceCode?.scopeManager?.globalScope;
      if (!rootScope) return resolved;

      const stack = [rootScope];
      while (stack.length > 0) {
        const scope = stack.pop()!;
        for (const reference of scope.references) {
          if (reference.resolved && wanted.has(reference.identifier)) {
            resolved.set(reference.identifier, reference.resolved);
          }
        }
        stack.push(...scope.childScopes);
      }
      return resolved;
    }

    /**
     * Returns the function nodes a variable is declared as, so a callee can be
     * matched against the declaration it actually refers to.
     */
    function declaredFunctions(variable: any): any[] {
      const targets: any[] = [];
      for (const def of variable.defs) {
        if (def.type === "FunctionName" && isFunctionNode(def.node)) {
          targets.push(def.node);
        } else if (
          def.node?.type === "VariableDeclarator" &&
          isFunctionNode(def.node.init)
        ) {
          targets.push(def.node.init);
        }
      }
      return targets;
    }

    function enterFunction(node: any) {
      const parent = functionStack[functionStack.length - 1];
      if (parent) enclosingFunction.set(node, parent);
      functionStack.push(node);
    }

    function exitFunction() {
      functionStack.pop();
    }

    return {
      FunctionDeclaration: enterFunction,
      FunctionExpression: enterFunction,
      ArrowFunctionExpression: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      "FunctionExpression:exit": exitFunction,
      "ArrowFunctionExpression:exit": exitFunction,

      CallExpression(node: any) {
        // Evaluated before the counter is updated, so a step call is not
        // considered to be inside itself - matching the previous
        // strict-ancestor semantics.
        const insideStep = stepDepth > 0;
        if (isStepCall(node)) stepDepth++;

        if (checkNode(node, insideStep)) return;

        if (node.callee?.type === "Identifier") {
          const enclosing = functionStack[functionStack.length - 1];
          if (enclosing) {
            callEdges.push({ callee: node.callee, enclosing });
          }
          if (!insideStep) {
            callsToCheck.push({ node, callee: node.callee });
          }
        }
      },

      "CallExpression:exit"(node: any) {
        if (isStepCall(node)) stepDepth--;
      },

      NewExpression(node: any) {
        checkNode(node, stepDepth > 0);
      },

      MemberExpression(node: any) {
        checkNode(node, stepDepth > 0);
      },

      "Program:exit"() {
        const wanted = new Set<any>();
        for (const { callee } of callEdges) wanted.add(callee);
        for (const { callee } of callsToCheck) wanted.add(callee);

        const resolvedCallees = resolveCallees(wanted);

        /** Resolves a callee identifier to the function nodes it may refer to. */
        const targetsOf = (callee: any): any[] => {
          const variable = resolvedCallees.get(callee);
          return variable ? declaredFunctions(variable) : [];
        };

        // target function -> functions that call it
        const dependents = new Map<any, Set<any>>();
        for (const { callee, enclosing } of callEdges) {
          for (const target of targetsOf(callee)) {
            let callers = dependents.get(target);
            if (!callers) {
              callers = new Set<any>();
              dependents.set(target, callers);
            }
            callers.add(enclosing);
          }
        }

        // Propagate non-determinism to callers and to lexically enclosing
        // functions, which are equally unsafe to call outside a step.
        const worklist = [...nonDeterministicFunctions];
        const mark = (fn: any) => {
          if (fn && !nonDeterministicFunctions.has(fn)) {
            nonDeterministicFunctions.add(fn);
            worklist.push(fn);
          }
        };

        while (worklist.length > 0) {
          const fn = worklist.pop()!;
          for (const caller of dependents.get(fn) ?? []) mark(caller);
          mark(enclosingFunction.get(fn));
        }

        for (const { node, callee } of callsToCheck) {
          if (
            targetsOf(callee).some((fn) => nonDeterministicFunctions.has(fn))
          ) {
            context.report({
              node,
              messageId: "nonDeterministicFunction",
              data: { functionName: callee.name },
            });
          }
        }
      },
    };
  },
};
