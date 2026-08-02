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
  // The closing delimiter must sit on the SAME LINE as the value, because that is
  // where the emitters put it. With a newline before it, a trailing `//` survived the
  // probe and then commented out the emitter's own `)` or `,` — so a value that
  // validated cleanly produced a syntax error, surfaced as an opaque esbuild failure
  // instead of a clear synth-time message.
  if (!parsesAsSingle(`const __probe = (${v});`, ts.isVariableStatement)) {
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

/**
 * Visits every `return` that belongs to THIS block, descending through control flow but
 * stopping at function and class boundaries — a `return` inside a nested helper belongs
 * to the helper, not to the block being validated.
 *
 * Checking only top-level statements was wrong in the common case: a conditional wait
 * duration (`if (fast) { return 5; } else { return 60; }`) is the most natural reason to
 * use the block form at all, and every such block was rejected as "never returns".
 */
function forEachOwnReturn(
  nodes: readonly ts.Node[],
  visit: (node: ts.ReturnStatement) => boolean,
): boolean {
  for (const n of nodes) {
    if (ts.isReturnStatement(n)) {
      if (visit(n)) return true;
      continue;
    }
    // A nested function or class owns its own returns.
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) continue;
    const children: ts.Node[] = [];
    ts.forEachChild(n, (c) => {
      children.push(c);
    });
    if (forEachOwnReturn(children, visit)) return true;
  }
  return false;
}

/** Parses `code` as the body of an IIFE and returns its top-level statements. */
function blockStatements(code: string): ts.Statement[] | undefined {
  const sf = ts.createSourceFile(
    "probe.ts",
    `(() => {\n${code}\n})();`,
    ts.ScriptTarget.Latest,
    true,
  );
  const diagnostics = (sf as unknown as { parseDiagnostics: unknown[] })
    .parseDiagnostics;
  if (diagnostics.length > 0) return undefined;
  let found: ts.Statement[] | undefined;
  const walk = (n: ts.Node): void => {
    if (!found && ts.isArrowFunction(n) && n.body && ts.isBlock(n.body)) {
      found = [...n.body.statements];
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return found;
}

/**
 * Validates code inlined as a STATEMENT BLOCK inside an expression the emitter
 * builds — a wait's `durationCode` in its block form, which becomes the body of an
 * IIFE.
 *
 * Two separate ways this goes wrong, and both must fail here:
 *
 *  - The block does not parse. Then the generated handler does not parse either, and
 *    the user meets an esbuild error that does not name the node.
 *  - The block parses but never RETURNS. Then the IIFE evaluates to `undefined` and
 *    the emitted duration is `{ seconds: undefined }` — no error anywhere, at build
 *    or at deploy. That is worse than a syntax error, because a syntax error is loud.
 *    `12 //` is the case that matters: it is not a valid expression, so it takes this
 *    path, and the comment swallows nothing except the return that was never there.
 *
 * Unlike a step's `code`, which is raw by design because the user is writing a whole
 * function body, this text sits inside an expression whose value is consumed.
 */
export function requireStatements(
  value: string,
  what: string,
  where: string,
): string {
  const v = value.trim();
  if (v === "") return v;
  const statements = blockStatements(v);
  if (!statements) {
    throw new Error(
      `${where}: ${what} is neither a single expression nor a valid block of ` +
        `statements, so the generated code would not parse.`,
    );
  }
  const returnsAValue = forEachOwnReturn(
    statements,
    (r) => r.expression !== undefined,
  );
  if (!returnsAValue) {
    throw new Error(
      `${where}: ${what} is a block that never returns a value, so it would ` +
        `evaluate to undefined with no error at build or deploy time. Return the ` +
        `value, or write it as a single expression.`,
    );
  }
  return v;
}

/**
 * Whether `code` returns a DURATION OBJECT where a number of seconds is expected.
 *
 * `durationCode` returns the wait in seconds (dar-specification.md) and the emitter
 * wraps it as `{ seconds: <code> }`, so returning `{ seconds: 30 }` yields
 * `{ seconds: { seconds: 30 } }`. That is the natural mistake, since the SDK's own
 * `wait()` takes exactly that shape, and esbuild does not typecheck so it ships.
 *
 * Checked on the AST, over TOP-LEVEL return statements only. A regex over the raw text
 * cannot tell the difference between the mistake and valid code that returns a
 * duration from a helper and then reads a field off it — and it matches inside
 * comments and string literals besides.
 */
export function returnsDurationObject(code: string): boolean {
  const DURATION_KEYS = new Set(["seconds", "minutes", "hours", "days"]);
  const isDurationLiteral = (e: ts.Expression): boolean =>
    ts.isObjectLiteralExpression(e) &&
    e.properties.some((prop) => {
      const name = prop.name;
      if (!name) return false;
      const text = ts.isIdentifier(name)
        ? name.text
        : ts.isStringLiteral(name)
          ? name.text
          : undefined;
      return text !== undefined && DURATION_KEYS.has(text);
    });

  const statements = blockStatements(code);
  if (statements) {
    // Same recursion as the return check: a conditional block that returns
    // `{ seconds: 30 }` from one arm is the same mistake, so looking only at the top
    // level would miss it.
    return forEachOwnReturn(
      statements,
      (r) => r.expression !== undefined && isDurationLiteral(r.expression),
    );
  }
  // Not a block — try it as a bare expression (`{ seconds: 30 }` on its own).
  const sf = ts.createSourceFile(
    "probe.ts",
    `const __probe = (${code});`,
    ts.ScriptTarget.Latest,
    true,
  );
  if (
    (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length >
    0
  ) {
    return false;
  }
  const decl = sf.statements[0];
  if (
    ts.isVariableStatement(decl) &&
    decl.declarationList.declarations[0]?.initializer
  ) {
    let init = decl.declarationList.declarations[0]
      .initializer as ts.Expression;
    while (ts.isParenthesizedExpression(init)) init = init.expression;
    return isDurationLiteral(init);
  }
  return false;
}
