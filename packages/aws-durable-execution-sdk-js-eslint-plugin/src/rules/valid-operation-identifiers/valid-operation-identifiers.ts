import { Rule } from "eslint";

/**
 * The service's limits for an operation's name and subtype. The checkpoint API
 * rejects a value outside them with a ValidationException, and the SDK sends
 * the value as given. A step with the default AT_LEAST_ONCE_PER_RETRY
 * semantics does not wait for its START checkpoint, so its function runs
 * before the rejection arrives. This rule reports the value before deploy.
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

/** Operations whose first argument is the name when it is a string. */
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

/** Operations whose config object accepts `subType`. */
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
  if (node?.type === "Literal" && typeof node.value === "string") {
    return { text: node.value, complete: true };
  }
  if (node?.type === "TemplateLiteral") {
    return {
      text: node.quasis.map((q: any) => q.value.cooked ?? "").join(""),
      complete: node.expressions.length === 0,
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

export const validOperationIdentifiers: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow an operation name or subType that the durable execution service rejects",
      recommended: true,
    },
    messages: {
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
    function checkName(node: any) {
      const value = staticText(node);
      // An empty name is not reported. This rule only covers the character
      // set and the maximum length.
      if (!value || value.text === "") return;
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

    return {
      CallExpression(node: any) {
        const callee = node.callee;
        if (
          callee?.type !== "MemberExpression" ||
          callee.computed ||
          callee.property?.type !== "Identifier"
        ) {
          return;
        }
        const operation = callee.property.name;

        if (NAMED_OPERATIONS.has(operation) && node.arguments.length > 0) {
          checkName(node.arguments[0]);
        }

        if (SUBTYPE_OPERATIONS.has(operation)) {
          for (const arg of node.arguments) {
            if (arg.type !== "ObjectExpression") continue;
            for (const prop of arg.properties) {
              if (
                prop.type === "Property" &&
                !prop.computed &&
                ((prop.key.type === "Identifier" &&
                  prop.key.name === "subType") ||
                  (prop.key.type === "Literal" && prop.key.value === "subType"))
              ) {
                checkSubType(prop.value);
              }
            }
          }
        }
      },
    };
  },
};
