/**
 * Structural guard: every parameter a tool DECLARES must be read by its handler.
 *
 * THE FAILURE THIS PREVENTS:
 * `query` declared a `limit` parameter, validated it (`.max(MAX_ROWS)`), and
 * described it to the model as the maximum number of rows to return -- then the
 * handler destructured only `{ sql, lookbackHours }` and nothing ever read it. An
 * agent asking for 10 rows got up to 1000. Every existing test passed: the schema
 * was valid, the description was accurate about the hard cap, and the tool worked.
 * The only thing wrong was that a promise in the schema had no implementation, and
 * nothing compared the two halves.
 *
 * WHY THIS READS THE AST:
 * The MCP SDK offers no way to ask a registered tool which arguments its handler
 * consumes -- once the schema and the callback are inside `registerTool`, the
 * connection between them is gone. They are only comparable at the source level.
 * A hand-rolled text scan was tried first and got this wrong (zod chains, template
 * literals and comments all contain brackets), so this uses the TypeScript parser
 * the repo already depends on. A guard that breaks on innocuous edits is worse
 * than no guard, because it gets deleted.
 *
 * A DELIBERATE LIMITATION:
 * This proves a declared parameter is *taken*, not that it changes behavior. A
 * parameter destructured and then dropped still passes. It catches the specific,
 * silent mistake of declaring a parameter and forgetting the handler.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

const SERVER_PATH = join(__dirname, "server.ts");

interface RegisteredTool {
  name: string;
  declared: string[];
  destructured: string[];
}

function parseRegisteredTools(): RegisteredTool[] {
  const source = ts.createSourceFile(
    SERVER_PATH,
    readFileSync(SERVER_PATH, "utf-8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const tools: RegisteredTool[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "registerTool"
    ) {
      const [nameArg, configArg, handlerArg] = node.arguments;
      if (nameArg && ts.isStringLiteral(nameArg)) {
        const declared: string[] = [];
        if (configArg && ts.isObjectLiteralExpression(configArg)) {
          for (const prop of configArg.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === "inputSchema" &&
              ts.isObjectLiteralExpression(prop.initializer)
            ) {
              for (const field of prop.initializer.properties) {
                if (field.name && ts.isIdentifier(field.name)) {
                  declared.push(field.name.text);
                }
              }
            }
          }
        }

        const destructured: string[] = [];
        if (
          handlerArg &&
          (ts.isArrowFunction(handlerArg) ||
            ts.isFunctionExpression(handlerArg)) &&
          handlerArg.parameters.length > 0
        ) {
          const first = handlerArg.parameters[0].name;
          if (ts.isObjectBindingPattern(first)) {
            for (const element of first.elements) {
              const key = element.propertyName ?? element.name;
              if (ts.isIdentifier(key)) destructured.push(key.text);
            }
          }
        }

        tools.push({ name: nameArg.text, declared, destructured });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return tools;
}

const tools = parseRegisteredTools();
const byName = new Map(tools.map((t) => [t.name, t]));

describe("every declared tool parameter is read by its handler", () => {
  it("parsed all five tools out of server.ts", () => {
    // Non-vacuity: a silently empty parse would make every assertion below pass
    // while checking nothing.
    expect(tools.map((t) => t.name).sort()).toEqual([
      "describe_schema",
      "get_execution",
      "list_executions",
      "query",
      "test_destination",
    ]);
  });

  it("found parameters known to exist", () => {
    // Aimed at the parser rather than the server: failing here means the parse
    // broke, not that a tool is wired wrongly.
    expect(byName.get("query")?.declared).toEqual(
      expect.arrayContaining(["sql", "limit", "lookbackHours"]),
    );
    expect(byName.get("get_execution")?.declared).toEqual(
      expect.arrayContaining(["executionArn", "year", "month", "day"]),
    );
    expect(byName.get("query")?.destructured).toContain("sql");
  });

  it.each(tools.map((t) => [t.name, t] as const))(
    "%s reads every parameter it declares",
    (_name, tool) => {
      const unread = tool.declared.filter(
        (p) => !tool.destructured.includes(p),
      );
      // A parameter here is one the model is told about, may spend tokens
      // setting, and which cannot possibly have an effect.
      expect(unread).toEqual([]);
    },
  );

  it.each(tools.map((t) => [t.name, t] as const))(
    "%s declares every parameter its handler destructures",
    (_name, tool) => {
      // The mirror direction: a handler argument the schema never declares can
      // only ever be undefined.
      const undeclared = tool.destructured.filter(
        (p) => !tool.declared.includes(p),
      );
      expect(undeclared).toEqual([]);
    },
  );
});
