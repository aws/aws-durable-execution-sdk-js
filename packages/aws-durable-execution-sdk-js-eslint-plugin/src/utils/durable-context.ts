/**
 * Finds which expressions in a file hold a durable context.
 *
 * Shared by the rules that must not report an unrelated library's method with
 * a common name, such as Playwright's `test.step` or lodash's `_.map`.
 */

/** TypeScript wrappers that do not change which value an expression has. */
export const TRANSPARENT_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

export function isFunctionNode(node: any): boolean {
  return (
    node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression" ||
    node?.type === "ArrowFunctionExpression"
  );
}

export function unwrap(node: any): any {
  let current = node;
  while (current && TRANSPARENT_WRAPPERS.has(current.type)) {
    current = current.expression;
  }
  return current;
}

/** Returns the name of a non-computed member call such as `ctx.map(...)`. */
export function methodName(call: any): string | null {
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
export function argumentParams(fn: any): any[] {
  const [first, ...rest] = fn.params;
  return first?.type === "Identifier" && first.name === "this"
    ? rest
    : fn.params;
}

/** Returns the identifier a parameter declares, through a default value. */
export function paramIdentifier(param: any): any {
  return param?.type === "AssignmentPattern" ? param.left : param;
}

export interface ChildCallback {
  /** The argument to report: an inline function or a function's name. */
  reportNode: any;
  /** The function the argument resolves to. */
  fn: any;
  operation: "runInChildContext" | "map" | "parallel";
}

export interface DurableContextTracker {
  /** Call from the rule's `CallExpression` visitor. */
  visitCall(node: any): void;
  /**
   * Runs the analysis. Call once, at `Program:exit`, when the scope analysis
   * covers the whole file.
   */
  analyze(): void;
  /** True if the expression is a parameter known to hold a durable context. */
  isDurableContext(node: any): boolean;
  /** The function an expression evaluates to, when the file shows it. */
  resolveFunction(node: any): any;
  /** The child-context functions a call passes. */
  childCallbacks(call: any): ChildCallback[];
  /** Every call to runInChildContext, map or parallel in the file. */
  readonly candidateCalls: readonly any[];
}

/**
 * Creates a tracker for one file.
 *
 * A parameter holds a durable context if it is one of these:
 * 1. annotated with the type `DurableContext`;
 * 2. the second parameter of a handler passed to `withDurableExecution`;
 * 3. the first parameter of a child-context function. A `runInChildContext`
 *    call passes one on any receiver. A `map` or `parallel` call passes
 *    one only when its receiver holds a durable context.
 */
export function createDurableContextTracker(
  sourceCode: any,
): DurableContextTracker {
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
  function childCallbacks(call: any): ChildCallback[] {
    const operation = methodName(call);
    const args = call.arguments;
    const callbacks: ChildCallback[] = [];
    const add = (reportNode: any, op: ChildCallback["operation"]): boolean => {
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
        for (const { fn } of childCallbacks(call)) {
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

  return {
    candidateCalls,
    visitCall(node: any) {
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
    analyze() {
      referenceOf = indexReferences();
      contexts = findContexts();
    },
    isDurableContext,
    resolveFunction,
    childCallbacks,
  };
}
