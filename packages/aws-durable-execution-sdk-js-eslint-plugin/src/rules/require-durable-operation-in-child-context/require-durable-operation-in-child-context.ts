import { Rule } from "eslint";

/**
 * ESLint rule that reports a child context whose body performs no durable
 * operation on the context it receives.
 *
 * A child context is the context that `runInChildContext` passes to its
 * function. `map` passes one to each item's function, and `parallel` passes
 * one to each branch. Only durable operations are checkpointed. So if the
 * body calls none on its context, its work runs again on every replay, and the
 * child context adds nothing. The user should put the work in a `step`.
 *
 * The rule decides with three answers: "yes", "no" and "unknown". It reports
 * only "no". "unknown" means the context reaches code the rule cannot read,
 * for example an imported function. That code may call a durable operation, so
 * the rule stays silent.
 *
 * Implementation notes:
 * - The callbacks are collected during the traversal and checked at
 *   `Program:exit`. By then the scope analysis covers the whole file, so a
 *   callback can be followed into a helper declared later in the file.
 * - `runInChildContext` is reported on any receiver, because no common library
 *   has a method with that name. `map` and `parallel` are common names, for
 *   example lodash `_.map` and async `parallel`. So the rule checks them only
 *   when the receiver is known to be a durable context. See
 *   `isDurableContext`.
 */

/** The methods of a durable context that create a durable operation. */
const DURABLE_OPERATIONS = new Set([
  "step",
  "invoke",
  "wait",
  "waitForCondition",
  "createCallback",
  "waitForCallback",
  "runInChildContext",
  "map",
  "parallel",
  // `context.promise.all(...)` and the other combinators. The SDK runs each
  // one as a durable operation.
  "promise",
]);

type Answer = "yes" | "no" | "unknown";

interface Callback {
  /** The argument to report: an inline function or a function's name. */
  reportNode: any;
  /** The function the argument resolves to. */
  fn: any;
  operation: "runInChildContext" | "map" | "parallel";
}

/** TypeScript wrappers that do not change which value an expression has. */
const TRANSPARENT_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

function isFunctionNode(node: any): boolean {
  return (
    node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression" ||
    node?.type === "ArrowFunctionExpression"
  );
}

function unwrap(node: any): any {
  let current = node;
  while (current && TRANSPARENT_WRAPPERS.has(current.type)) {
    current = current.expression;
  }
  return current;
}

/** Returns the name of a non-computed member call such as `ctx.map(...)`. */
function methodName(call: any): string | null {
  const callee = call.callee;
  if (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.property?.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return null;
}

/** True if the type annotation names `DurableContext`, with or without a namespace. */
function isDurableContextType(typeAnnotation: any): boolean {
  const type = typeAnnotation?.typeAnnotation;
  if (type?.type !== "TSTypeReference") return false;
  const name = type.typeName;
  if (name?.type === "Identifier") return name.name === "DurableContext";
  if (name?.type === "TSQualifiedName") {
    return name.right?.name === "DurableContext";
  }
  return false;
}

export const requireDurableOperationInChildContext: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require a child context to perform at least one durable operation on its context",
      recommended: false,
    },
    messages: {
      noDurableOperation:
        "This {{operation}} function calls no durable operation on its context. So its work is not checkpointed, and it runs again on every replay. Put the work in a step.",
    },
    schema: [],
  },
  create(context) {
    // See no-non-deterministic-outside-step for why both forms are read.
    const sourceCode: any =
      (context as any).sourceCode ?? (context as any).getSourceCode?.();

    /** Every call to runInChildContext, map or parallel in the file. */
    const candidateCalls: any[] = [];

    /** Identifier node -> the reference ESLint's scope analysis made for it. */
    let referenceOf = new Map<any, any>();

    function indexReferences(): Map<any, any> {
      const index = new Map<any, any>();
      const rootScope = sourceCode?.scopeManager?.globalScope;
      if (!rootScope) return index;
      const stack = [rootScope];
      while (stack.length > 0) {
        const scope = stack.pop()!;
        for (const reference of scope.references) {
          index.set(reference.identifier, reference);
        }
        stack.push(...scope.childScopes);
      }
      return index;
    }

    /**
     * Returns the function an expression evaluates to, when the file shows it.
     *
     * An inline function returns itself. A name returns the function it is
     * declared as, either `function f() {}` or `const f = () => {}`. Anything
     * else returns null.
     */
    function resolveFunction(node: any): any {
      const target = unwrap(node);
      if (isFunctionNode(target)) return target;
      if (target?.type !== "Identifier") return null;

      const variable = referenceOf.get(target)?.resolved;
      if (!variable || variable.defs.length !== 1) return null;
      const [def] = variable.defs;
      if (def.type === "FunctionName" && isFunctionNode(def.node)) {
        return def.node;
      }
      if (
        def.node?.type === "VariableDeclarator" &&
        def.node.parent?.kind === "const" &&
        isFunctionNode(unwrap(def.node.init))
      ) {
        return unwrap(def.node.init);
      }
      return null;
    }

    /**
     * Returns the child-context functions a call passes, and which argument
     * names each one.
     */
    function callbacksOf(call: any): Callback[] {
      const operation = methodName(call);
      const args = call.arguments;
      const callbacks: Callback[] = [];
      const add = (reportNode: any, op: Callback["operation"]): boolean => {
        const fn = resolveFunction(reportNode);
        if (fn) callbacks.push({ reportNode, fn, operation: op });
        return fn !== null;
      };

      if (operation === "runInChildContext") {
        // runInChildContext(fn, config?) or runInChildContext(name, fn, config?)
        if (!add(args[0], operation)) add(args[1], operation);
      } else if (operation === "map") {
        // map(items, fn, config?) or map(name, items, fn, config?)
        if (!isDurableContext(call.callee.object)) return [];
        if (!add(args[1], operation)) add(args[2], operation);
      } else if (operation === "parallel") {
        // parallel(branches, config?) or parallel(name, branches, config?).
        // A branch is a function or `{ name?, func }`.
        if (!isDurableContext(call.callee.object)) return [];
        const branches = [unwrap(args[0]), unwrap(args[1])].find(
          (arg) => arg?.type === "ArrayExpression",
        );
        for (const element of branches?.elements ?? []) {
          const branch = unwrap(element);
          if (branch?.type === "ObjectExpression") {
            const func = branch.properties.find(
              (p: any) =>
                p.type === "Property" &&
                !p.computed &&
                (p.key?.name === "func" || p.key?.value === "func"),
            );
            if (func) add(func.value, operation);
          } else if (branch) {
            add(branch, operation);
          }
        }
      }
      return callbacks;
    }

    /**
     * True if the expression is known to be a durable context.
     *
     * The expression must be a parameter that is one of these:
     * 1. annotated with the type `DurableContext`;
     * 2. the second parameter of the handler passed to `withDurableExecution`;
     * 3. the first parameter of a child-context function this rule recognizes.
     */
    function isDurableContext(node: any): boolean {
      const target = unwrap(node);
      if (target?.type !== "Identifier") return false;
      const variable = referenceOf.get(target)?.resolved;
      const def = variable?.defs.length === 1 ? variable.defs[0] : null;
      if (def?.type !== "Parameter") return false;

      const param = def.name;
      if (isDurableContextType(param.typeAnnotation)) return true;

      const fn = def.node;
      const index = fn.params.indexOf(param);
      if (index === 1) return isHandlerOfWithDurableExecution(fn);
      if (index === 0) return isChildContextFunction(fn);
      return false;
    }

    /** Climbs from a function to the call it is an argument of, if any. */
    function enclosingCall(fn: any): any {
      let node = fn;
      while (node.parent && TRANSPARENT_WRAPPERS.has(node.parent.type)) {
        node = node.parent;
      }
      return node.parent;
    }

    function isHandlerOfWithDurableExecution(fn: any): boolean {
      const call = enclosingCall(fn);
      if (call?.type !== "CallExpression" || unwrap(call.arguments[0]) !== fn) {
        return false;
      }
      const callee = call.callee;
      return (
        (callee.type === "Identifier" &&
          callee.name === "withDurableExecution") ||
        methodName(call) === "withDurableExecution"
      );
    }

    /**
     * True if the function is passed inline as a child-context function.
     *
     * A parallel branch sits inside an array, and maybe inside `{ func }`, so
     * the climb goes past those nodes to the call.
     */
    function isChildContextFunction(fn: any): boolean {
      let node = enclosingCall(fn);
      if (node?.type === "Property") node = node.parent?.parent;
      if (node?.type === "ArrayExpression") node = node.parent;
      while (node && TRANSPARENT_WRAPPERS.has(node.type)) node = node.parent;
      if (node?.type !== "CallExpression") return false;
      return callbacksOf(node).some((callback) => callback.fn === fn);
    }

    /**
     * Answers whether `fn` calls a durable operation on its parameter at
     * `index`, directly or through helpers in the file it passes it to.
     *
     * `inProgress` breaks recursion. A function that passes the context back
     * to a function still being checked adds no evidence, so that path
     * answers "no".
     */
    function performsDurableOperation(
      fn: any,
      index: number,
      inProgress: Set<string>,
    ): Answer {
      let param = fn.params[index];
      // A function that declares no parameter here cannot use the context.
      if (!param) return "no";
      if (param.type === "AssignmentPattern") param = param.left;
      // A destructured or rest parameter: the rule does not follow it.
      if (param.type !== "Identifier") return "unknown";

      const key = `${fn.range?.[0]}:${index}`;
      if (inProgress.has(key)) return "no";
      inProgress.add(key);

      const variable = sourceCode.scopeManager
        .getDeclaredVariables(fn)
        .find((v: any) => v.defs.some((d: any) => d.name === param));
      if (!variable) return "unknown";

      let answer: Answer = "no";
      for (const reference of variable.references) {
        const use = classifyUse(reference, inProgress);
        if (use === "yes") return "yes";
        if (use === "unknown") answer = "unknown";
      }
      return answer;
    }

    /** Classifies one reference to a context parameter. */
    function classifyUse(reference: any, inProgress: Set<string>): Answer {
      // A TypeScript type such as `typeof ctx` uses no value at run time.
      // typescript-eslint records `typeof ctx` as a value reference, so the
      // parent node is checked too.
      if (
        reference.isTypeReference ||
        reference.identifier.parent?.type === "TSTypeQuery"
      ) {
        return "no";
      }
      // A reassigned context may hold anything.
      if (reference.isWrite()) return "unknown";

      let node = reference.identifier;
      while (node.parent && TRANSPARENT_WRAPPERS.has(node.parent.type)) {
        node = node.parent;
      }
      const parent = node.parent;

      // ctx.step(...), ctx.promise.all(...), ctx.logger.info(...)
      if (parent?.type === "MemberExpression" && parent.object === node) {
        if (parent.computed || parent.property?.type !== "Identifier") {
          return "unknown";
        }
        if (!DURABLE_OPERATIONS.has(parent.property.name)) return "no";
        if (parent.property.name === "promise") return "yes";
        let member = parent;
        if (member.parent?.type === "ChainExpression") member = member.parent;
        // `const s = ctx.step` detaches the method. The rule does not track it.
        return member.parent?.type === "CallExpression" &&
          member.parent.callee === member
          ? "yes"
          : "unknown";
      }

      // helper(ctx): follow the context into the helper if the file shows it.
      if (parent?.type === "CallExpression" && parent.callee !== node) {
        const argIndex = parent.arguments.indexOf(node);
        const helper = resolveFunction(parent.callee);
        if (argIndex < 0 || !helper) return "unknown";
        return performsDurableOperation(helper, argIndex, inProgress);
      }

      // Returned, stored, spread, called, or passed to `new`: the rule cannot
      // see what happens to it next.
      return "unknown";
    }

    return {
      CallExpression(node: any) {
        const name = methodName(node);
        if (
          name === "runInChildContext" ||
          name === "map" ||
          name === "parallel"
        ) {
          candidateCalls.push(node);
        }
      },

      "Program:exit"() {
        if (candidateCalls.length === 0) return;
        referenceOf = indexReferences();

        const reported = new Set<any>();
        for (const call of candidateCalls) {
          for (const { reportNode, fn, operation } of callbacksOf(call)) {
            if (reported.has(reportNode)) continue;
            if (performsDurableOperation(fn, 0, new Set()) !== "no") continue;
            reported.add(reportNode);
            context.report({
              node: reportNode,
              messageId: "noDurableOperation",
              data: {
                operation:
                  operation === "parallel" ? "parallel branch" : operation,
              },
            });
          }
        }
      },
    };
  },
};
