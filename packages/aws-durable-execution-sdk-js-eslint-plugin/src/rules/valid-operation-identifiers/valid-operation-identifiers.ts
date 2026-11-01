import { Rule } from "eslint";
import {
  createDurableContextTracker,
  methodName,
  unwrap,
} from "../../utils/durable-context";

/**
 * The service's limits for an operation's name and subtype. The checkpoint API
 * rejects a value outside them with a ValidationException, and the SDK sends
 * the value as given. A step with the default AT_LEAST_ONCE_PER_RETRY
 * semantics does not wait for its START checkpoint, so its function runs
 * before the rejection arrives. This rule reports the value before deploy.
 *
 * The rule checks only calls on a durable context, so a method with the same
 * name on another object, such as Playwright's `test.step`, is not reported.
 * See `createDurableContextTracker` for how a durable context is recognized.
 */
const NAME_MAX_LENGTH = 256;
const SUBTYPE_MAX_LENGTH = 32;

/** Printable ASCII, 0x20 to 0x7E. */
function isNameChar(code: number): boolean {
  return code >= 0x20 && code <= 0x7e;
}

/** a-z, A-Z, 0-9, "-" and "_". */
function isSubTypeChar(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x2d ||
    code === 0x5f
  );
}

/** Context methods whose first argument is the name when it is a string. */
const NAMED_OPERATIONS = new Set([
  "step",
  "runInChildContext",
  "wait",
  "waitForCondition",
  "createCallback",
  "waitForCallback",
  "map",
  "parallel",
]);

/** `context.promise` methods whose first argument is the name. */
const PROMISE_COMBINATORS = new Set(["all", "allSettled", "any", "race"]);

/** Context methods whose config object accepts `subType`. */
const SUBTYPE_OPERATIONS = new Set([
  "step",
  "runInChildContext",
  "createCallback",
]);

/**
 * The text of a string the code fixes in place. `complete` is false for a
 * template literal with expressions: then only the characters of its fixed
 * parts are known, not the length.
 */
function staticText(node: any): { text: string; complete: boolean } | null {
  const target = unwrap(node);
  if (target?.type === "Literal" && typeof target.value === "string") {
    return { text: target.value, complete: true };
  }
  if (target?.type === "TemplateLiteral") {
    return {
      text: target.quasis.map((q: any) => q.value.cooked ?? "").join(""),
      complete: target.expressions.length === 0,
    };
  }
  return null;
}

function firstBadChar(
  text: string,
  isAllowed: (code: number) => boolean,
): string | null {
  for (const char of text) {
    if (!isAllowed(char.codePointAt(0)!)) return char;
  }
  return null;
}

function describeChar(char: string): string {
  const code = char.codePointAt(0)!;
  const hex = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  return code >= 0x20 && code !== 0x7f ? `"${char}" (${hex})` : hex;
}

/** Returns the value of a non-computed `key` property of an object literal. */
function propertyValues(object: any, key: string): any[] {
  const values: any[] = [];
  for (const prop of object.properties) {
    if (prop.type !== "Property" || prop.computed || prop.kind !== "init") {
      continue;
    }
    const name =
      prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
    if (name === key) values.push(prop.value);
  }
  return values;
}

export const validOperationIdentifiers: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow an operation name or subType that the durable execution service rejects",
      recommended: true,
    },
    messages: {
      nameEmpty:
        "Operation name is empty. The service requires at least 1 character and fails the execution. Omit the name instead.",
      invalidNameChar:
        "Operation name contains {{char}}. The service accepts only printable ASCII (0x20 to 0x7E) and fails the execution.",
      nameTooLong:
        "Operation name is {{length}} characters. The service accepts at most 256 and fails the execution.",
      invalidSubTypeChar:
        'subType contains {{char}}. The service accepts only a-z, A-Z, 0-9, "-" and "_" and fails the execution.',
      subTypeTooLong:
        "subType is {{length}} characters. The service accepts at most 32 and fails the execution.",
    },
    schema: [],
  },
  create(context) {
    // See no-non-deterministic-outside-step for why both forms are read.
    const sourceCode: any =
      (context as any).sourceCode ?? (context as any).getSourceCode?.();
    const tracker = createDurableContextTracker(sourceCode);

    /** Member calls that may be durable operations, checked at the end. */
    const calls: any[] = [];

    function checkName(node: any) {
      const value = staticText(node);
      if (!value) return;
      if (value.complete && value.text === "") {
        context.report({ node, messageId: "nameEmpty" });
        return;
      }
      const bad = firstBadChar(value.text, isNameChar);
      if (bad) {
        context.report({
          node,
          messageId: "invalidNameChar",
          data: { char: describeChar(bad) },
        });
      } else if (value.complete && value.text.length > NAME_MAX_LENGTH) {
        context.report({
          node,
          messageId: "nameTooLong",
          data: { length: String(value.text.length) },
        });
      }
    }

    function checkSubType(node: any) {
      const value = staticText(node);
      // An empty subType selects the operation's default subtype.
      if (!value || value.text === "") return;
      const bad = firstBadChar(value.text, isSubTypeChar);
      if (bad) {
        context.report({
          node,
          messageId: "invalidSubTypeChar",
          data: { char: describeChar(bad) },
        });
      } else if (value.complete && value.text.length > SUBTYPE_MAX_LENGTH) {
        context.report({
          node,
          messageId: "subTypeTooLong",
          data: { length: String(value.text.length) },
        });
      }
    }

    function checkContextCall(node: any, operation: string) {
      const args = node.arguments;

      if (NAMED_OPERATIONS.has(operation) && args.length > 0) {
        checkName(args[0]);
      }

      // invoke(name, funcId, ...) or invoke(funcId, input?, ...). The SDK
      // reads the first argument as the name only when the second is a
      // string, so the rule does the same.
      if (operation === "invoke" && staticText(args[1])) {
        checkName(args[0]);
      }

      // A named parallel branch, `{ name, func }`, names its child context.
      if (operation === "parallel") {
        const branches = [unwrap(args[0]), unwrap(args[1])].find(
          (arg) => arg?.type === "ArrayExpression",
        );
        for (const element of branches?.elements ?? []) {
          const branch = unwrap(element);
          if (branch?.type !== "ObjectExpression") continue;
          for (const name of propertyValues(branch, "name")) checkName(name);
        }
      }

      if (SUBTYPE_OPERATIONS.has(operation)) {
        for (const arg of args) {
          const config = unwrap(arg);
          if (config?.type !== "ObjectExpression") continue;
          for (const subType of propertyValues(config, "subType")) {
            checkSubType(subType);
          }
        }
      }
    }

    return {
      CallExpression(node: any) {
        tracker.visitCall(node);
        if (methodName(node)) calls.push(node);
      },

      "Program:exit"() {
        if (calls.length === 0) return;
        tracker.analyze();

        for (const node of calls) {
          const operation = methodName(node)!;
          const receiver = unwrap(node.callee.object);

          if (tracker.isDurableContext(receiver)) {
            checkContextCall(node, operation);
            continue;
          }

          // context.promise.all(name, promises) and the other combinators.
          if (
            PROMISE_COMBINATORS.has(operation) &&
            receiver?.type === "MemberExpression" &&
            !receiver.computed &&
            receiver.property?.name === "promise" &&
            tracker.isDurableContext(receiver.object) &&
            node.arguments.length > 0
          ) {
            checkName(node.arguments[0]);
          }
        }
      },
    };
  },
};
