import { Rule } from "eslint";
import {
  TRANSPARENT_WRAPPERS,
  argumentParams,
  createDurableContextTracker,
  paramIdentifier,
} from "../../utils/durable-context";

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
 *   `createDurableContextTracker` in `utils/durable-context.ts`.
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

    const tracker = createDurableContextTracker(sourceCode);
    const resolveFunction = tracker.resolveFunction;

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
        tracker.visitCall(node);
      },

      "Program:exit"() {
        if (tracker.candidateCalls.length === 0) return;
        tracker.analyze();

        const reported = new Set<any>();
        for (const call of tracker.candidateCalls) {
          for (const { reportNode, fn, operation } of tracker.childCallbacks(
            call,
          )) {
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
