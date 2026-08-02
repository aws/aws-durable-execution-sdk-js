/**
 * Guards for author-supplied strings that get interpolated into GENERATED CODE
 * rather than into string literals.
 *
 * These all render as short, one-line fields in the Studio inspector — a node's
 * result type, an SDK command name, a `runIf` predicate — so a payload hidden in
 * one is invisible to someone reviewing the workflow on the canvas. That is the
 * threat these address, and it is why they are checked even though the workflow
 * is nominally authored by the person deploying it: a `.dar.ts` can also arrive
 * from a model, from an imported state machine, or from a deployed function.
 *
 * Everything here decides by PARSING, never by executing: the text must form
 * exactly the one construct it is being dropped into, so anything that closes the
 * enclosing syntax and continues with statements is rejected.
 *
 * Deliberately NOT covered: a step's or inline node's `code`. Those are whole
 * function bodies, raw by design.
 *
 * Lives in its own module so the code generator and the strategy emitter can
 * share one implementation without importing each other.
 */
import * as ts from "typescript";

/** A single dotted identifier, e.g. `S3Client` or `foo.Bar`. */
const IDENT_PATH_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

/** Rejects a value that would escape the code position it is emitted into. */
export function requireIdentifier(
  value: string,
  what: string,
  nodeName: string,
): string {
  const v = value.trim();
  if (!IDENT_PATH_RE.test(v)) {
    throw new Error(
      `Node "${nodeName}": ${what} "${value}" is not a valid identifier.`,
    );
  }
  return v;
}

/** True when `source` parses to exactly one statement of the expected kind. */
function parsesAsSingle(
  source: string,
  is: (s: ts.Statement) => boolean,
): boolean {
  const probe = ts.createSourceFile(
    "probe.ts",
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
  const parseErrors = (probe as unknown as { parseDiagnostics: unknown[] })
    .parseDiagnostics;
  return (
    parseErrors.length === 0 &&
    probe.statements.length === 1 &&
    is(probe.statements[0])
  );
}

/**
 * Validates a TYPE expression (a node's `resultType`, the workflow's
 * `inputType`). Unchecked, `inputType` reached `type WorkflowInput = ${x};` at
 * the top level — running on every cold start — and `resultType` reached the
 * `let ${ident}: (${x});` declaration emitted for nodes with error handling,
 * which, unlike the `const` form, has no initializer to hold the
 * parenthesization together.
 */
export function requireTypeExpression(
  value: string,
  what: string,
  where: string,
): string {
  const v = value.trim();
  if (v === "") return v;
  if (!parsesAsSingle(`type __Probe = (${v});`, ts.isTypeAliasDeclaration)) {
    throw new Error(
      `${where}: ${what} is not a valid TypeScript type. ` +
        `Expected a type expression such as "{ orderId: string }".`,
    );
  }
  return v;
}

/**
 * Validates a VALUE expression (`runIf`, `shouldComplete`, a poll's stop
 * expression). These stay expressions by design — they close over `deps`,
 * `status` or `state` — so this does not restrict what they may compute. It only
 * requires that they ARE one expression.
 */
export function requireExpression(
  value: string,
  what: string,
  where: string,
): string {
  const v = value.trim();
  if (v === "") return v;
  if (!parsesAsSingle(`const __probe = (\n${v}\n);`, ts.isVariableStatement)) {
    throw new Error(`${where}: ${what} is not a single JavaScript expression.`);
  }
  return v;
}

/**
 * An AWS SDK v3 client package name, validated because it lands verbatim in an
 * `import … from "<pkg>"` specifier in generated code.
 *
 * `clientClass` and `command` next to it are already checked, but the specifier
 * itself was not. `JSON.stringify` prevents breaking out of the string, so this is
 * not a syntax-injection hole — the problem is what esbuild does with it: a `.dar`
 * from a model or an ASL import can name ANY module, including a relative path,
 * and the bundler will happily resolve and bundle it. It fails closed only when
 * the module cannot be resolved, which is not a control.
 *
 * The Studio's SDK reflection only ever produces `@aws-sdk/client-*`, so that is
 * the whole legitimate range.
 */
export function requireSdkClientPackage(value: string, where: string): string {
  const v = value.trim();
  if (!/^@aws-sdk\/client-[a-z0-9-]+$/.test(v)) {
    throw new Error(
      `${where}: client package ${JSON.stringify(v)} is not an AWS SDK v3 client ` +
        `package (expected @aws-sdk/client-<service>).`,
    );
  }
  return v;
}

/**
 * Validates the interpolations in a template literal that generated code emits.
 *
 * The httpCall `url` is emitted inside a template literal, and `${` is
 * deliberately preserved so a URL can reference upstream results. That makes it an
 * unrestricted EXPRESSION position — but unlike `headers`, `query` and `body` on
 * the same node, it never reached {@link requireExpression}. An httpCall node has
 * no `code` field, so a reviewer looking at it sees a URL and nothing else: the
 * "payload hidden in a one-line field, invisible on the canvas" case the other
 * validation exists for.
 *
 * Parses the whole constructed literal, then requires each `${…}` span to be a
 * single expression, restoring parity with the sibling fields.
 */
export function requireTemplateLiteral(
  literalBody: string,
  what: string,
  where: string,
): string {
  if (
    !parsesAsSingle(
      `const __probe = (\`${literalBody}\`);`,
      ts.isVariableStatement,
    )
  ) {
    throw new Error(`${where}: ${what} is not a valid template literal.`);
  }
  // Each interpolation must be exactly one expression, as for the sibling fields.
  const src = ts.createSourceFile(
    "probe.ts",
    `const __probe = (\`${literalBody}\`);`,
    ts.ScriptTarget.Latest,
    true,
  );
  const spans: string[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isTemplateSpan(n)) spans.push(n.expression.getText(src));
    ts.forEachChild(n, walk);
  };
  walk(src);
  for (const span of spans)
    requireExpression(span, `${what} interpolation`, where);
  return literalBody;
}
