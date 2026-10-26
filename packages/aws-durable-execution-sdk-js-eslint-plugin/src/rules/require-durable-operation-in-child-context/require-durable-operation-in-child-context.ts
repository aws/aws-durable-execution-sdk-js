import { Rule } from "eslint";

/**
 * ESLint rule that reports a child context whose body performs no durable
 * operation on the context it receives.
 *
 * A child context is the context that `runInChildContext` passes to its
 * function. `map` passes one to each item's function, and `parallel` passes
 * one to each branch. A child context saves its function's result when the
 * function finishes, and a replay returns that result. So a function with no
 * durable operation usually does not run again. It still differs from a step
 * in two ways:
 * 1. The result is larger than the checkpoint size limit. Then the SDK runs
 *    the function again on every replay to rebuild the result.
 * 2. The function throws. A step retries its work, and a child context does
 *    not.
 * So the rule tells the user to put the work in a `step`.
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
 *   `findContexts`.
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

/**
 * Returns the parameters that receive call arguments.
 *
 * A TypeScript `this` parameter is the first entry of `fn.params`, but a call
 * passes no argument for it. So it is dropped.
 */
function argumentParams(fn: any): any[] {
  const [first, ...rest] = fn.params;
  return first?.type === "Identifier" && first.name === "this"
    ? rest
    : fn.params;
}

/** Returns the identifier a parameter declares, through a default value. */
function paramIdentifier(param: any): any {
  return param?.type === "AssignmentPattern" ? param.left : param;
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
        "This {{operation}} function calls no durable operation on its context. Put the work in a step.",
    },
    schema: [],
  },
  create(context) {
    // See no-non-deterministic-outside-step for why both forms are read.
    const sourceCode: any =
      (context as any).sourceCode ?? (context as any).getSourceCode?.();

    /** Every call to runInChildContext, map or parallel in the file. */
    const candidateCalls: any[] = [];

    /** Every call to withDurableExecution in the file. */
    const wrapperCalls: any[] = [];

    /** Identifier node -> the reference ESLint's scope analysis made for it. */
    let referenceOf = new Map<any, any>();

    /** The parameter variables known to hold a durable context. */
    let contexts = new Set<any>();

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
     * else returns null. So does a function declaration that the file assigns
     * a new value to, because the name may then hold another function.
     */
    function resolveFunction(node: any): any {
      const target = unwrap(node);
      if (isFunctionNode(target)) return target;
      if (target?.type !== "Identifier") return null;

      const variable = referenceOf.get(target)?.resolved;
      if (!variable || variable.defs.length !== 1) return null;
      const [def] = variable.defs;
      if (def.type === "FunctionName" && isFunctionNode(def.node)) {
        const reassigned = variable.references.some((r: any) => r.isWrite());
        return reassigned ? null : def.node;
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
            const func = effectiveFunc(branch);
            if (func) add(func, operation);
          } else if (branch) {
            add(branch, operation);
          }
        }
      }
      return callbacks;
    }

    /**
     * Returns the value of a branch object's `func` property, when the object
     * shows which value the SDK reads.
     *
     * A later property overrides an earlier one with the same key. So the last
     * `func` property is the one that counts. Three later shapes can still
     * override it: a spread, a computed key, and another `func`. A spread and
     * a computed key can hide a `func`, so the answer is null. An accessor
     * such as `get func()` returns a value the rule does not compute, so the
     * answer is also null.
     */
    function effectiveFunc(branch: any): any {
      for (let i = branch.properties.length - 1; i >= 0; i--) {
        const property = branch.properties[i];
        if (property.type !== "Property" || property.computed) return null;
        const key = property.key?.name ?? property.key?.value;
        if (key !== "func") continue;
        return property.kind === "init" ? property.value : null;
      }
      return null;
    }

    /**
     * True if the type annotation names `DurableContext`. The name can have a
     * namespace, as in `sdk.DurableContext`. It can also be an import alias,
     * as in `import type { DurableContext as Ctx }`.
     */
    function isDurableContextType(typeAnnotation: any): boolean {
      const type = typeAnnotation?.typeAnnotation;
      if (type?.type !== "TSTypeReference") return false;
      const name = type.typeName;
      if (name?.type === "TSQualifiedName") {
        return name.right?.name === "DurableContext";
      }
      if (name?.type !== "Identifier") return false;
      if (name.name === "DurableContext") return true;

      const def = referenceOf.get(name)?.resolved?.defs[0];
      const imported = def?.type === "ImportBinding" ? def.node.imported : null;
      return (imported?.name ?? imported?.value) === "DurableContext";
    }

    /** True if the expression is a parameter in `contexts`. */
    function isDurableContext(node: any): boolean {
      const target = unwrap(node);
      if (target?.type !== "Identifier") return false;
      return contexts.has(referenceOf.get(target)?.resolved);
    }

    /** Returns the variable of the parameter that receives argument `index`. */
    function paramVariable(fn: any, index: number): any {
      const param = paramIdentifier(argumentParams(fn)[index]);
      if (param?.type !== "Identifier") return null;
      return sourceCode.scopeManager
        .getDeclaredVariables(fn)
        .find((v: any) => v.defs.some((d: any) => d.name === param));
    }

    /**
     * Finds every parameter that is known to hold a durable context.
     *
     * A parameter holds a durable context if it is one of these:
     * 1. annotated with the type `DurableContext`;
     * 2. the second parameter of a handler passed to `withDurableExecution`;
     * 3. the first parameter of a child-context function. A `runInChildContext`
     *    call passes one on any receiver. A `map` or `parallel` call passes
     *    one only when its receiver holds a durable context.
     *
     * Cases 1 and 2 are read directly. Case 3 depends on other parameters, so
     * the function repeats a pass over the candidate calls until a pass adds
     * no parameter. The set only grows, so the loop ends. Each pass costs one
     * look at every candidate call. An earlier recursive version checked the
     * receivers again for each lookup, which took factorial time on a file
     * with many unrelated `xs.map(...)` helpers.
     */
    function findContexts(): Set<any> {
      const found = new Set<any>();

      const stack = [sourceCode.scopeManager.globalScope];
      while (stack.length > 0) {
        const scope = stack.pop()!;
        for (const variable of scope.variables) {
          const def = variable.defs.length === 1 ? variable.defs[0] : null;
          if (
            def?.type === "Parameter" &&
            isDurableContextType(def.name.typeAnnotation)
          ) {
            found.add(variable);
          }
        }
        stack.push(...scope.childScopes);
      }

      for (const call of wrapperCalls) {
        const handler = resolveFunction(call.arguments[0]);
        const variable = handler && paramVariable(handler, 1);
        if (variable) found.add(variable);
      }

      contexts = found;
      let added = true;
      while (added) {
        added = false;
        for (const call of candidateCalls) {
          for (const { fn } of callbacksOf(call)) {
            const variable = paramVariable(fn, 0);
            if (variable && !found.has(variable)) {
              found.add(variable);
              added = true;
            }
          }
        }
      }
      return found;
    }

    /**
     * True if a non-arrow function reads `arguments`. Such a function can read
     * an argument that no parameter declares.
     */
    function readsArguments(fn: any): boolean {
      if (fn.type === "ArrowFunctionExpression") return false;
      const scope = sourceCode.scopeManager.acquire(fn);
      const variable = scope?.set?.get("arguments");
      return (variable?.references.length ?? 0) > 0;
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
      // `arguments` can reach the context through any index.
      if (readsArguments(fn)) return "unknown";

      const params = argumentParams(fn);
      const restIndex = params.findIndex((p) => p.type === "RestElement");
      // A rest parameter collects this argument. The rule does not follow it.
      if (restIndex >= 0 && index >= restIndex) return "unknown";

      // A function that declares no parameter here cannot use the context.
      const param = paramIdentifier(params[index]);
      if (!param) return "no";
      // A destructured parameter: the rule does not follow it.
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
      // A default value such as `ctx = fallback` writes the parameter. It is
      // used only when the caller passes nothing, so it is not a use.
      if (reference.init) return "no";
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
        // A spread argument before the context hides the context's index.
        const before = parent.arguments.slice(0, argIndex);
        if (before.some((arg: any) => arg.type === "SpreadElement")) {
          return "unknown";
        }
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
        if (
          name === "withDurableExecution" ||
          (node.callee.type === "Identifier" &&
            node.callee.name === "withDurableExecution")
        ) {
          wrapperCalls.push(node);
        }
      },

      "Program:exit"() {
        if (candidateCalls.length === 0) return;
        referenceOf = indexReferences();
        contexts = findContexts();

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
