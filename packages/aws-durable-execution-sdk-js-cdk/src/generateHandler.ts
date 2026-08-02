import * as ts from "typescript";
import type { DarNode, DarWorkflow, ErrorBranch } from "./darModel";
import {
  errorEdgesFor,
  getServiceIntegration,
  inferDependencyKind,
  TRIGGER_RULES,
  type TriggerRule,
  type DagConfigSpec,
  type DagCompletionConfigSpec,
} from "@aws/durable-execution-sdk-js-visual-workflow-model";
import { buildIdentifierMap } from "./identifiers";
import {
  requireExpression,
  requireSdkClientPackage,
  requireStatements,
  returnsDurationObject,
  requireTemplateLiteral,
  requireIdentifier,
  requireTypeExpression,
} from "./validateEmitted";
import {
  emitRetryStrategy,
  emitWaitStrategy,
  retrySpecOf,
  waitSpecOf,
} from "./strategy";

/**
 * A lexical scope for emission. Container bodies (map/group/parallel branches)
 * recurse with a different context variable and a deeper indent.
 */
interface Scope {
  /** Durable context variable in scope (`context` / `childCtx` / `ctx`). */
  ctxVar: string;
  /** Leading spaces for statements at this level. */
  indent: number;
  /** Named SDK imports the generated handler needs (collected as we emit). */
  imports: Set<string>;
  /**
   * Options for this generation. Threaded here rather than held in a module-level
   * variable: `Scope` already reaches every emitter frame, so a global bought
   * nothing and made the dag gate depend on assignment order.
   */
  opts?: GenerateHandlerOptions;
}

/** Indents every non-empty line of `code` by `spaces` spaces. */
function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

/**
 * Prefix for the invisible per-node sentinel comment {@link nodeMarker} emits.
 * Exported (as a value, not just used internally) so {@link buildSourceMap}
 * — the only other reader of these markers — stays in lockstep with the exact
 * format, rather than duplicating a regex literal in two places.
 */
export const NODE_MARKER_PREFIX = "/*@dar:";

/**
 * A single-line, otherwise-inert comment marking "the next line(s) below this
 * one are node `node.id`'s emitted code" — pushed as its own array entry
 * immediately before a node's real emitted line(s) in {@link emitChain}. Not
 * meant to be read by a human: {@link buildSourceMap} greps these out of the
 * final generated string (by exact line content) to build a `handler.ts` line
 * -> `.dar` node id table, the first stage of the generated-`index.js` ->
 * `.dar` source map (see that function's own doc comment for the full
 * pipeline). Kept as a real, harmless comment line (rather than e.g. a
 * zero-width sentinel) so the generated handler stays valid, readable
 * TypeScript even before any map-building runs over it — `generateHandler`
 * strips every marker line back out before returning the handler source (see
 * {@link stripNodeMarkers}), so the DEPLOYED code is never affected: markers
 * only ever exist in an intermediate string, never in the emitted artifact
 * a caller receives from `generateHandler` or ships to Lambda.
 */
function nodeMarker(node: DarNode): string {
  return `${NODE_MARKER_PREFIX}${node.id}*/`;
}

/**
 * Prefix for {@link bodyStartMarker}/{@link bodyEndMarker} — brackets a
 * node's VERBATIM-spliced code (`step`/`inline`/`condition`/
 * `waitForCondition`/`callback` bodies, always emitted via `indent(body, n)`)
 * so `buildHandlerSourceMap` (in `sourceMap.ts`) knows exactly which
 * generated lines are real body lines — as opposed to the surrounding
 * wrapper lines (`await ctx.step(name, async () => {`, the closing
 * `}, { retryStrategy: ... })`, etc.) that have no 1:1 `.dar.ts` line
 * counterpart. Without this, naively counting "lines since {@link
 * nodeMarker}" mis-attributes the FIRST wrapper line as if it were the
 * body's first line, shifting every mapping in the block by one (a real bug
 * found and fixed while implementing statement-level `.dar.ts` mapping —
 * confirmed via a direct dump of generated code + map mappings side by side).
 */
const BODY_MARKER_PREFIX = "/*@darbody:";
export { BODY_MARKER_PREFIX };

function bodyStartMarker(): string {
  return `${BODY_MARKER_PREFIX}start*/`;
}
function bodyEndMarker(): string {
  return `${BODY_MARKER_PREFIX}end*/`;
}

/** Removes every {@link nodeMarker}/{@link bodyStartMarker}/
 *  {@link bodyEndMarker} line (and its trailing newline) from `src`. */
function stripNodeMarkers(src: string): string {
  return src
    .replace(
      new RegExp(
        `^[ \\t]*${escapeRegExp(NODE_MARKER_PREFIX)}[^\\n]*\\*/\\n?`,
        "gm",
      ),
      "",
    )
    .replace(
      new RegExp(
        `^[ \\t]*${escapeRegExp(BODY_MARKER_PREFIX)}[^\\n]*\\*/\\n?`,
        "gm",
      ),
      "",
    );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Runtime helper the payload fix delegates to. Emitted only when used. */
const PAYLOAD_DECODE_HELPER_NAME = "__darDecodePayload";
const PAYLOAD_DECODE_HELPER = `const ${PAYLOAD_DECODE_HELPER_NAME} = (p: unknown): string =>
  typeof p === "string" ? p : new TextDecoder().decode(p as Uint8Array);`;

/**
 * Safety net for a very common AWS SDK v3 footgun in generated step code:
 * `@aws-sdk/client-lambda`'s InvokeCommand returns `Payload` as a **Uint8Array**,
 * so `JSON.parse(response.Payload)` throws ("Unexpected non-whitespace character
 * after JSON..."). Rewrites `JSON.parse(<expr>.Payload)` to decode first.
 *
 * Two things this deliberately does NOT do, both of which it used to:
 *
 *  - It no longer decodes unconditionally. `TextDecoder().decode` THROWS on a
 *    string, and `Payload` is a string for several other services — so the safety
 *    net could turn working author code into broken code. It now delegates to
 *    {@link PAYLOAD_DECODE_HELPER}, which passes a string through untouched, making
 *    the rewrite a genuine no-op when the value was already fine.
 *
 *  - It no longer rewrites the file as raw text. A regex over the whole output also
 *    matched inside comments and STRING LITERALS, so a step that returned a code
 *    sample as data had its data silently edited — in a body this package otherwise
 *    treats as verbatim. The rewrite is now driven by the parsed AST, so only real
 *    `JSON.parse(x.Payload)` call expressions are touched and comments and literals
 *    are excluded by construction.
 */
function fixLambdaPayloadDecoding(src: string): string {
  const file = ts.createSourceFile(
    "generated.ts",
    src,
    ts.ScriptTarget.Latest,
    true,
  );
  // Collect the argument spans of `JSON.parse(<expr>.Payload)`, innermost first so
  // splicing later offsets cannot disturb earlier ones.
  const targets: { start: number; end: number; text: string }[] = [];
  const walk = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.expression.getText(file) === "JSON" &&
      n.expression.name.text === "parse" &&
      n.arguments.length === 1
    ) {
      const arg = n.arguments[0];
      if (ts.isPropertyAccessExpression(arg) && arg.name.text === "Payload") {
        targets.push({
          start: arg.getStart(file),
          end: arg.getEnd(),
          text: arg.getText(file),
        });
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(file);
  if (targets.length === 0) return src;

  let out = src;
  for (const t of [...targets].sort((a, b) => b.start - a.start)) {
    out =
      out.slice(0, t.start) +
      `${PAYLOAD_DECODE_HELPER_NAME}(${t.text})` +
      out.slice(t.end);
  }
  // Insert the helper after the import block so it is in scope for the handler.
  const afterImports = (() => {
    const parsed = ts.createSourceFile(
      "g.ts",
      out,
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = parsed.statements.filter(ts.isImportDeclaration);
    return imports.length > 0 ? imports[imports.length - 1].getEnd() : 0;
  })();
  return (
    out.slice(0, afterImports) +
    `\n\n${PAYLOAD_DECODE_HELPER}` +
    out.slice(afterImports)
  );
}

/** True for kinds that produce a value worth binding to a result const. */
function bindsResult(kind: DarNode["kind"]): boolean {
  return kind !== "wait" && kind !== "start" && kind !== "end";
}

/**
 * Emits `text` (JSON or a JS expression) as an inline value. JSON is
 * re-serialized for a clean literal; non-JSON text is treated as a JS
 * expression and passed through. Blank text falls back to `fallback`.
 */
/**
 * A value field (a payload, an input, an initial state) emitted into generated
 * code. JSON is re-serialized and is inherently safe. Anything else is an
 * expression written by the user and interpolated verbatim, so it is validated
 * the same way `runIf`/`shouldComplete` are: it must parse as exactly ONE
 * JavaScript expression.
 *
 * Without that check this was the widest hole in the injection controls — these
 * fields render as short one-liners in the inspector, so a statement sequence
 * hidden in one is invisible to someone reviewing the canvas, which is precisely
 * the threat the validation elsewhere exists to stop. It accepted, for example, a
 * payload that closed the call early, exfiltrated the execution role's
 * credentials, and commented out the trailing syntax. Step code is raw by design
 * so this was never privilege escalation, but the field is not step code and
 * should not behave like it.
 */
function emitValue(
  text: unknown,
  fallback: string,
  what: string,
  where: string,
): string {
  const t = typeof text === "string" ? text.trim() : "";
  if (t === "") return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return requireExpression(t, what, where);
  }
  const json = JSON.stringify(parsed);
  // Re-emitting JSON as an object LITERAL is not semantics-preserving for one key:
  // `{"__proto__": {...}}` parses to an own data property, but the same text as a
  // literal ASSIGNS the prototype. That silently diverges the deployed behaviour
  // from the `.dar` the user saved. Ordinary values keep the readable literal;
  // anything mentioning `__proto__` round-trips through JSON.parse, which preserves
  // the data-property meaning exactly.
  if (/"__proto__"/.test(json)) {
    return `JSON.parse(${JSON.stringify(json)})`;
  }
  return json;
}

/** A string field, or `fallback` when missing/blank. */
function strField(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim().length > 0 ? v : fallback;
}

/** Duration/timeout unit, whitelisted — these become object KEYS in the
 *  generated code, so an arbitrary string would be an injection surface. */
const DURATION_UNITS = new Set(["seconds", "minutes", "hours", "days"]);
function unitField(v: unknown, fallback: string): string {
  return typeof v === "string" && DURATION_UNITS.has(v) ? v : fallback;
}

/** A finite-number field, or `fallback` otherwise. */
function numField(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** HTTP methods a `httpCall` node may use (whitelisted — never interpolated raw). */
const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/** Auth styles a `httpCall` node supports. The secret ALWAYS comes from an env var. */
const HTTP_AUTH_KINDS = new Set(["none", "bearer", "header", "basic", "query"]);

/** A valid POSIX env var name — anything else is rejected rather than emitted. */
const ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Emits the body of the durable step wrapping one `httpCall` node: a single
 * `fetch` with query params, headers, optional JSON body and a status check.
 *
 * Uses the Node 22 runtime's GLOBAL `fetch` on purpose — no import, no
 * dependency to bundle. Third-party credentials are read from `process.env`
 * at call time and NEVER inlined: a `.dar.ts` is committed to git and embedded
 * verbatim in the deployment zip (see `deploy.ts`'s WORKFLOW_DAR_TS_FILENAME),
 * so a literal key in the model would leak into both.
 *
 * Every interpolated value is either whitelisted (method, auth kind),
 * `JSON.stringify`-quoted (env var name, auth param name), or a JS expression
 * the author already owns (`emitValue` for headers/query/body — same contract
 * as `awsSdkCall`'s `input`). `url` is emitted as a TEMPLATE LITERAL so it can
 * interpolate upstream results (`${order_id}`); backslashes and backticks are
 * escaped so a URL can't break out of the literal.
 */
function httpCallLines(node: DarNode, i: number): string[] {
  const p = " ".repeat(i);
  const n = node as unknown as Record<string, unknown>;

  const rawMethod =
    typeof n.method === "string" ? n.method.trim().toUpperCase() : "";
  const method = HTTP_METHODS.has(rawMethod) ? rawMethod : "GET";

  const rawUrl = strField(n.url, "");
  if (rawUrl.trim() === "") {
    throw new Error(`httpCall node "${node.name}" is missing a url.`);
  }
  // Escape only what could terminate the template literal. `${` is left
  // intact deliberately — interpolating upstream results is the point.
  const urlTpl = requireTemplateLiteral(
    rawUrl.replace(/\\/g, "\\\\").replace(/`/g, "\\`"),
    "url",
    `httpCall "${node.name}"`,
  );

  const authKindRaw = typeof n.authKind === "string" ? n.authKind : "none";
  const authKind = HTTP_AUTH_KINDS.has(authKindRaw) ? authKindRaw : "none";
  const envVar = typeof n.authEnvVar === "string" ? n.authEnvVar.trim() : "";
  if (authKind !== "none") {
    if (envVar === "") {
      throw new Error(
        `httpCall node "${node.name}" uses ${authKind} auth but has no authEnvVar. ` +
          `Third-party credentials must come from a Lambda environment variable.`,
      );
    }
    if (!ENV_VAR_RE.test(envVar)) {
      throw new Error(
        `httpCall node "${node.name}" has an invalid authEnvVar ${JSON.stringify(
          envVar,
        )} (expected an environment variable NAME like API_KEY, not a value).`,
      );
    }
  }
  const secret = `process.env[${JSON.stringify(envVar)}] ?? ""`;

  const hasBody = method !== "GET" && method !== "HEAD";
  const bodyExpr = typeof n.body === "string" ? n.body.trim() : "";
  const emitBody = hasBody && bodyExpr !== "";

  const lines: string[] = [`${p}const url = new URL(\`${urlTpl}\`);`];

  // Query params: the author's object, plus the credential when auth is
  // carried in the query string. Null/undefined entries are skipped so an
  // optional param can be left unset by an upstream expression.
  const queryExpr = typeof n.query === "string" ? n.query.trim() : "";
  if (queryExpr !== "" || authKind === "query") {
    const base =
      queryExpr !== ""
        ? emitValue(queryExpr, "{}", "query", `httpCall "${node.name}"`)
        : "{}";
    lines.push(`${p}const query: Record<string, unknown> = ${base};`);
    if (authKind === "query") {
      const authName = strField(n.authName, "api_key");
      lines.push(`${p}query[${JSON.stringify(authName)}] = ${secret};`);
    }
    lines.push(
      `${p}for (const [k, v] of Object.entries(query)) {`,
      `${p}  if (v !== undefined && v !== null) url.searchParams.set(k, String(v));`,
      `${p}}`,
    );
  }

  // Headers: content-type first (overridable by the author), then the
  // author's headers, then auth last so it always wins.
  const headersExpr = typeof n.headers === "string" ? n.headers.trim() : "";
  const headerParts: string[] = [];
  if (emitBody) headerParts.push(`"content-type": "application/json"`);
  if (headersExpr !== "")
    headerParts.push(
      `...(${emitValue(headersExpr, "{}", "headers", `httpCall "${node.name}"`)})`,
    );
  if (authKind === "bearer")
    headerParts.push(`Authorization: \`Bearer \${${secret}}\``);
  if (authKind === "basic")
    headerParts.push(
      `Authorization: \`Basic \${Buffer.from(${secret}).toString("base64")}\``,
    );
  if (authKind === "header") {
    const authName = strField(n.authName, "X-API-Key");
    headerParts.push(`[${JSON.stringify(authName)}]: ${secret}`);
  }
  lines.push(
    `${p}const headers: Record<string, string> = { ${headerParts.join(", ")} };`,
  );

  const initParts = [`method: ${JSON.stringify(method)}`, `headers`];
  if (emitBody) {
    // Bind once: the author's expression may be a call or otherwise
    // side-effecting, so it must not be evaluated twice.
    lines.push(
      `${p}const payload = ${emitValue(bodyExpr, "{}", "body", `httpCall "${node.name}"`)};`,
    );
    initParts.push(
      `body: typeof payload === "string" ? payload : JSON.stringify(payload)`,
    );
  }
  const timeout = numField(n.timeoutSeconds, 0);
  if (timeout > 0)
    initParts.push(
      `signal: AbortSignal.timeout(${Math.round(timeout * 1000)})`,
    );

  lines.push(
    `${p}const response = await fetch(url, {`,
    ...initParts.map((x) => `${p}  ${x},`),
    `${p}});`,
    `${p}const text = await response.text();`,
    `${p}if (!response.ok) {`,
    `${p}  throw new Error(\`HTTP \${response.status} \${response.statusText} for \${url.pathname}: \${text.slice(0, 500)}\`);`,
    `${p}}`,
    // Most APIs answer JSON, but 204s and text/plain are common enough that
    // failing to parse must not fail the step.
    `${p}try {`,
    `${p}  return text === "" ? null : JSON.parse(text);`,
    `${p}} catch {`,
    `${p}  return text;`,
    `${p}}`,
  );
  return lines;
}

/**
 * True when `text` is a single TypeScript EXPRESSION rather than a statement
 * block — i.e. it can be dropped straight into a value position.
 *
 * Decided by parsing, never by executing: the text is user-authored, and this
 * package's contract is that it is only ever analysed statically. A `return`
 * statement, a declaration, or multiple statements all fail to parse in a value
 * position and are reported as "not an expression".
 */
function isExpressionText(text: string): boolean {
  // Delegates to the shared validator so there is exactly one definition of "is a
  // single expression". The result gates RAW INLINING of a wait's durationCode, so a
  // laxer check here emits code that does not parse — and esbuild reports that without
  // naming the node.
  try {
    requireExpression(text, "expression", "codegen");
    return text.trim() !== "";
  } catch {
    return false;
  }
}

/**
 * Edges grouped by source node id, preserving definition order (so switch
 * cases and the linear "first" edge are deterministic).
 */
function edgesBySource(wf: DarWorkflow): Map<string, DarWorkflow["edges"]> {
  const map = new Map<string, DarWorkflow["edges"]>();
  for (const e of wf.edges) {
    const list = map.get(e.source);
    if (list) list.push(e);
    else map.set(e.source, [e]);
  }
  return map;
}

/** The target of a node's first outgoing edge, if any. */
function firstFlowTarget(
  adj: Map<string, DarWorkflow["edges"]>,
  id: string,
): string | undefined {
  // Error edges route only on failure — never part of the normal flow chain.
  return (adj.get(id) ?? []).find((e) => e.kind !== "error")?.target;
}

/** `completionConfig: { … }` fragment from a map/parallel node, or "". */
function emitCompletionConfig(node: DarNode): string {
  const fields: string[] = [];
  const minSuccessful = node.minSuccessful;
  const tolCount = node.toleratedFailureCount;
  const tolPct = node.toleratedFailurePercentage;
  // Number.isFinite, not typeof === "number": NaN and Infinity are both numbers and
  // were interpolated verbatim, so a malformed `.dar` emitted
  // `minSuccessful: NaN` — valid syntax that the SDK then has to cope with.
  if (Number.isFinite(minSuccessful))
    fields.push(`minSuccessful: ${minSuccessful}`);
  if (Number.isFinite(tolCount))
    fields.push(`toleratedFailureCount: ${tolCount}`);
  if (Number.isFinite(tolPct))
    fields.push(`toleratedFailurePercentage: ${tolPct}`);
  return fields.length > 0 ? `completionConfig: { ${fields.join(", ")} }` : "";
}

/** Joins config fragments into a `, { … }` suffix, or "" when empty. */
function configSuffix(fields: string[]): string {
  const present = fields.filter((f) => f.length > 0);
  return present.length > 0 ? `, { ${present.join(", ")} }` : "";
}

/**
 * Emits a node's durable call as an **expression** (no `const`/`let` binding and
 * no trailing `;`). The first line is unindented; continuation lines and the
 * closing token are indented to `scope.indent`, so a caller can prepend
 * `const X = ` / `X = ` at any indent. Binding + error handling is composed by
 * {@link emitChain}.
 */
function emitNode(node: DarNode, scope: Scope): string {
  const pad = " ".repeat(scope.indent);
  const inner = scope.indent + 2;
  const ctx = scope.ctxVar;
  const name = JSON.stringify(node.name);
  const { imports } = scope;
  switch (node.kind) {
    case "step": {
      const body =
        typeof node.code === "string" && node.code.trim().length > 0
          ? node.code
          : "return undefined;";
      const config = `, { retryStrategy: ${emitRetryStrategy(
        retrySpecOf(node),
        imports,
      )} }`;
      return [
        `await ${ctx}.step(${name}, async (stepCtx) => {`,
        indent(bodyStartMarker(), inner),
        indent(body, inner),
        indent(bodyEndMarker(), inner),
        `${pad}}${config})`,
      ].join("\n");
    }
    case "awsSdkCall": {
      // A single AWS SDK v3 call wrapped in a durable step. `command` is the
      // full command class name (e.g. "PutItemCommand"); the client + command
      // are chosen in the Studio via runtime reflection.
      const clientPackage =
        typeof node.clientPackage === "string" ? node.clientPackage : "";
      const clientClassRaw =
        typeof node.clientClass === "string" ? node.clientClass : "";
      const commandRaw = typeof node.command === "string" ? node.command : "";
      if (!clientPackage || !clientClassRaw || !commandRaw) {
        throw new Error(
          `awsSdkCall node "${node.name}" is missing clientPackage/clientClass/command.`,
        );
      }
      // Interpolated into a `new X()` call AND an import list. Today an injected
      // import list happens to break the parse, but that is an accident of
      // formatting, not a control.
      const clientClass = requireIdentifier(
        clientClassRaw,
        "client class",
        node.name,
      );
      const command = requireIdentifier(commandRaw, "command", node.name);
      imports.add(
        `@sdk|${requireSdkClientPackage(clientPackage, `node "${node.name}"`)}|${clientClass}|${command}`,
      );
      const input = emitValue(node.input, "{}", "input", `node "${node.name}"`);
      const region =
        typeof node.region === "string" && node.region.trim().length > 0
          ? `{ region: ${JSON.stringify(node.region.trim())} }`
          : "{}";
      const config = `, { retryStrategy: ${emitRetryStrategy(
        retrySpecOf(node),
        imports,
      )} }`;
      const p2 = " ".repeat(inner);
      return [
        `await ${ctx}.step(${name}, async () => {`,
        `${p2}const client = new ${clientClass}(${region});`,
        `${p2}return await client.send(new ${command}(${input} as never));`,
        `${pad}}${config})`,
      ].join("\n");
    }
    case "httpCall": {
      // A single third-party HTTP request wrapped in a durable step. Auth
      // comes from a Lambda env var — see httpCallLines' doc comment.
      const config = `, { retryStrategy: ${emitRetryStrategy(
        retrySpecOf(node),
        imports,
      )} }`;
      return [
        `await ${ctx}.step(${name}, async () => {`,
        ...httpCallLines(node, inner),
        `${pad}}${config})`,
      ].join("\n");
    }
    case "wait": {
      // (unit whitelisted below — a raw string here would be an object-key
      // injection into the generated code)
      // A dynamic duration (TS block returning SECONDS, computed from
      // upstream results — deterministic by the replay rules) overrides the
      // static value/unit pair.
      const durationCode =
        typeof node.durationCode === "string" && node.durationCode.trim() !== ""
          ? node.durationCode
          : null;
      if (durationCode) {
        // Two spellings are accepted, because "seconds" reads like a value and
        // requiring `return` for `12` was a silent trap: a bare expression fell
        // through the IIFE as `undefined`, producing `{ seconds: undefined }`
        // with no error anywhere.
        //   - an EXPRESSION (`12`, `get_order.retryAfter`) is inlined directly;
        //   - a STATEMENT BLOCK (`const x = …; return x;`) keeps the IIFE.
        // Per dar-specification.md, durationCode returns the wait in SECONDS. The
        // emitter wraps it as `{ seconds: <code> }`, so returning a DURATION OBJECT —
        // the natural mistake, since the SDK's own wait() takes `{ seconds: 30 }` —
        // silently produces `{ seconds: { seconds: 30 } }`, and esbuild does not
        // typecheck so it ships. Checked on the AST over top-level returns: text
        // matching cannot distinguish this from valid code that gets a duration from
        // a helper and reads a field off it.
        if (returnsDurationObject(durationCode)) {
          throw new Error(
            `Node "${node.name}": duration code must return the wait in SECONDS ` +
              `(for example "return 30;"), not a duration object — returning ` +
              `{ seconds: ... } would emit { seconds: { seconds: ... } }.`,
          );
        }
        // Both forms are interpolated verbatim, so both need checking: the expression
        // form by isExpressionText above, the block form here.
        if (!isExpressionText(durationCode)) {
          requireStatements(
            durationCode,
            "duration code",
            `node "${node.name}"`,
          );
        }
        if (isExpressionText(durationCode)) {
          return `await ${ctx}.wait(${name}, { seconds: (${durationCode.trim()}) })`;
        }
        return [
          `await ${ctx}.wait(${name}, { seconds: (() => {`,
          indent(durationCode, scope.indent + 2),
          `${" ".repeat(scope.indent)}})() })`,
        ].join("\n");
      }
      const unit = unitField(node.durationUnit, "seconds");
      const value = numField(node.durationValue, 0);
      return `await ${ctx}.wait(${name}, { ${unit}: ${value} })`;
    }
    case "inline": {
      // Plain, non-checkpointed TypeScript between durable operations: runs
      // inline on every replay (so it must be deterministic + side-effect-free)
      // and binds its result to a const for downstream nodes. No step/checkpoint
      // => no retry; error handling is a try/catch via onError (handled by the
      // generic error-handling path). For non-deterministic/IO work, use a step.
      const body =
        typeof node.code === "string" && node.code.trim().length > 0
          ? node.code
          : "return undefined;";
      return [
        `(() => {`,
        indent(bodyStartMarker(), inner),
        indent(body, inner),
        indent(bodyEndMarker(), inner),
        `${pad}})()`,
      ].join("\n");
    }
    case "callback": {
      const unit = unitField(node.timeoutUnit, "hours");
      const value = numField(node.timeoutValue, 24);
      const body =
        typeof node.submitterCode === "string" &&
        node.submitterCode.trim().length > 0
          ? node.submitterCode
          : "// send `callbackId` to the external system";
      return [
        `await ${ctx}.waitForCallback(${name}, async (callbackId, ctx) => {`,
        indent(bodyStartMarker(), inner),
        indent(body, inner),
        indent(bodyEndMarker(), inner),
        `${pad}}, { timeout: { ${unit}: ${value} } })`,
      ].join("\n");
    }
    case "chainInvoke": {
      const arn = JSON.stringify(
        strField(node.functionArn, "REPLACE_WITH_FUNCTION_ARN"),
      );
      const payload = emitValue(
        node.payload,
        "{}",
        "payload",
        `node "${node.name}"`,
      );
      return `await ${ctx}.invoke(${name}, ${arn}, ${payload})`;
    }
    case "waitForCondition": {
      const body =
        typeof node.code === "string" && node.code.trim().length > 0
          ? node.code
          : "return { ...state };";
      const initialState = emitValue(
        node.initialState,
        "{}",
        "initialState",
        `node "${node.name}"`,
      );
      const stopExpr =
        typeof node.stopCondition === "string" &&
        node.stopCondition.trim().length > 0
          ? node.stopCondition.trim()
          : undefined;
      const waitStrategy = emitWaitStrategy(
        waitSpecOf(node),
        imports,
        stopExpr,
      );
      return [
        `await ${ctx}.waitForCondition(${name}, async (state, ctx) => {`,
        indent(bodyStartMarker(), inner),
        indent(body, inner),
        indent(bodyEndMarker(), inner),
        `${pad}}, { initialState: ${initialState}, waitStrategy: ${waitStrategy} })`,
      ].join("\n");
    }
    case "group": {
      const child = emitBody(node.body as DarWorkflow, {
        ...scope,
        ctxVar: "childCtx",
        indent: inner,
        imports,
      });
      return [
        `await ${ctx}.runInChildContext(${name}, async (childCtx) => {`,
        child,
        `${pad}})`,
      ].join("\n");
    }
    case "dagContainer": {
      // A container whose inner body is ALWAYS a DAG scope (the corrected DAG
      // model: nested DAG is a `dagContainer`, never a group-with-dag-body).
      // In this LINEAR parent scope it emits a `context.dag("<name>",
      // (dag) => { <registrations> }, <cfg>)` expression — the same linear-vs-
      // dag form switch every kind makes. The body's tasks emit as DAG
      // registrations (its `dependencyMode` is "dag"), reusing the shared
      // `emitDagRegistrations` + `emitDagConfigSuffix` helpers (design §4.4,§6).
      const body = node.body as DarWorkflow;
      const innerIdents = buildIdentifierMap(body.nodes);
      const innerById = new Map(body.nodes.map((n) => [n.id, n]));
      const regs = emitDagRegistrations(
        body,
        // Spread the parent scope so `opts` reaches the dag gate. Building a fresh
        // literal here dropped it, which is how this arm bypassed the gate before.
        { ...scope, ctxVar: "dag", indent: inner, imports },
        "dag",
        innerIdents,
        innerById,
      );
      const cfg = emitDagConfigSuffix(
        (node.dagConfig ?? body.dagConfig) as DagConfigSpec | undefined,
        imports,
      );
      return [
        `await ${ctx}.dag(${name}, (dag) => {`,
        ...regs,
        `${pad}}${cfg})`,
      ].join("\n");
    }
    case "map": {
      const itemsCode =
        typeof node.itemsCode === "string" && node.itemsCode.trim().length > 0
          ? node.itemsCode
          : "return [];";
      const items = [
        `((): unknown[] => {`,
        indent(itemsCode, inner),
        // Guard against nullish items (e.g. optional/missing input) so the map
        // iterates an empty array instead of throwing on `items.length`.
        `${pad}})() ?? []`,
      ].join("\n");
      const child = emitBody(node.body as DarWorkflow, {
        ...scope,
        ctxVar: "ctx",
        indent: inner,
        imports,
      });
      let nesting = "";
      if (node.nesting === "FLAT") {
        imports.add("NestingType");
        nesting = "nesting: NestingType.FLAT";
      }
      const config = configSuffix([
        Number.isFinite(node.maxConcurrency)
          ? `maxConcurrency: ${node.maxConcurrency}`
          : "",
        emitCompletionConfig(node),
        nesting,
      ]);
      return [
        `await ${ctx}.map(${name}, ${items}, async (ctx, item, index) => {`,
        child,
        `${pad}}${config})`,
      ].join("\n");
    }
    case "awsJob": {
      const preset = getServiceIntegration(
        typeof node.integration === "string" ? node.integration : undefined,
      );
      if (!preset) {
        throw new Error(
          `awsJob node "${node.name}" has an unknown integration ${JSON.stringify(
            node.integration,
          )}.`,
        );
      }
      // Record the SDK client + commands so generateHandler emits the import.
      imports.add(
        `@sdk|${preset.clientPackage}|${preset.clientClass}|${preset.start.command}|${preset.poll.command}`,
      );
      const startInput = emitValue(
        node.startInput,
        "{}",
        "startInput",
        `node "${node.name}"`,
      );
      const pollSeconds =
        typeof node.pollIntervalSeconds === "number" &&
        Number.isFinite(node.pollIntervalSeconds) &&
        node.pollIntervalSeconds > 0
          ? node.pollIntervalSeconds
          : preset.defaultPollSeconds;
      const clientNew =
        typeof node.region === "string" && node.region.trim().length > 0
          ? `new ${preset.clientClass}({ region: ${JSON.stringify(node.region.trim())} })`
          : `new ${preset.clientClass}({})`;
      const success = JSON.stringify(preset.success);
      const failure = JSON.stringify(preset.failure);
      // Bound the poll loop so a never-terminating job can't poll until the
      // durable execution timeout: cap attempts at maxWaitSeconds / pollSeconds.
      const maxAttempts = Math.max(
        1,
        Math.ceil(preset.maxWaitSeconds / pollSeconds),
      );
      const resultExpr = preset.poll.resultPath
        ? `(final.result as Record<string, any>)?.${preset.poll.resultPath}`
        : "final.result";
      const p2 = " ".repeat(inner);
      const p3 = " ".repeat(inner + 2);
      const p4 = " ".repeat(inner + 4);
      return [
        `await ${ctx}.runInChildContext(${name}, async (childCtx) => {`,
        `${p2}const startInput = ${startInput} as Record<string, any>;`,
        `${p2}const started = (await childCtx.step(${JSON.stringify(
          node.name + "-start",
        )}, async () => {`,
        `${p3}const client = ${clientNew};`,
        `${p3}return await client.send(new ${preset.start.command}(startInput as never));`,
        `${p2}})) as Record<string, any>;`,
        `${p2}const jobId = started.${preset.start.idPath};`,
        `${p2}const final = (await childCtx.waitForCondition(`,
        `${p3}${JSON.stringify(node.name + "-wait")},`,
        `${p3}async (state) => {`,
        `${p4}const client = ${clientNew};`,
        `${p4}const res = (await client.send(new ${preset.poll.command}(${preset.poll.inputExpr} as never))) as Record<string, any>;`,
        `${p4}return { ...state, status: res.${preset.poll.statusPath}, result: res };`,
        `${p3}},`,
        `${p3}{`,
        `${p4}initialState: { status: ${JSON.stringify(
          preset.initialStatus,
        )}, result: null as unknown },`,
        `${p4}waitStrategy: (state: { status?: string }, attempt: number) => ({`,
        `${p4}  shouldContinue:`,
        `${p4}    attempt < ${maxAttempts} &&`,
        `${p4}    !${success}.includes(state.status as string) &&`,
        `${p4}    !${failure}.includes(state.status as string),`,
        `${p4}  delay: { seconds: ${pollSeconds} },`,
        `${p4}}),`,
        `${p3}},`,
        `${p2})) as { status?: string; result: unknown };`,
        `${p2}if (${failure}.includes(final.status as string)) {`,
        `${p3}throw new Error(${JSON.stringify(
          node.name + " failed: ",
        )} + final.status);`,
        `${p2}}`,
        `${p2}if (!${success}.includes(final.status as string)) {`,
        `${p3}throw new Error(`,
        `${p4}${JSON.stringify(
          node.name +
            " did not complete within ~" +
            preset.maxWaitSeconds +
            "s: ",
        )} + final.status,`,
        `${p3});`,
        `${p2}}`,
        `${p2}return ${resultExpr};`,
        `${pad}})`,
      ].join("\n");
    }
    case "parallel": {
      const branches = Array.isArray(node.branches)
        ? (node.branches as { name: string; body: DarWorkflow }[])
        : [];
      const branchPad = " ".repeat(inner);
      const branchLines = branches.map((b) => {
        const body = emitBody(b.body, {
          ...scope,
          ctxVar: "ctx",
          indent: inner + 2,
          imports,
        });
        return [
          `${branchPad}{`,
          `${branchPad}  name: ${JSON.stringify(b.name)},`,
          `${branchPad}  func: async (ctx) => {`,
          body,
          `${branchPad}  },`,
          `${branchPad}},`,
        ].join("\n");
      });
      const config = configSuffix([
        Number.isFinite(node.maxConcurrency)
          ? `maxConcurrency: ${node.maxConcurrency}`
          : "",
        emitCompletionConfig(node),
      ]);
      return [
        `await ${ctx}.parallel(${name}, [`,
        ...branchLines,
        `${pad}]${config})`,
      ].join("\n");
    }
    default:
      throw new Error(
        `Codegen for node kind "${node.kind}" is not implemented yet.`,
      );
  }
}

/**
 * Emits the terminal statement for an `end` node: either a `return` (of the
 * node's code block, or the last result when blank) or a `throw` (of the node's
 * code block, or a default Error when blank), per the node's `endMode`.
 */
function emitEnd(node: DarNode, scope: Scope, lastIdent?: string): string {
  const pad = " ".repeat(scope.indent);
  const code = typeof node.code === "string" ? node.code.trim() : "";
  if (code.length > 0) return indent(code, scope.indent);
  if (node.endMode === "throw") {
    const msg = JSON.stringify(`Workflow ended at "${node.name}".`);
    return `${pad}throw new Error(${msg});`;
  }
  return `${pad}return ${lastIdent ?? "undefined"};`;
}

/**
 * Emits the linear chain of nodes starting at `startId`, following each node's
 * single outgoing edge. A `condition` node emits a `switch` (recursing into
 * each branch's tail) and terminates the chain. `visited` guards against
 * cycles WITHIN a single chain/branch. It is deliberately NOT shared across a
 * condition's branches (see {@link emitCondition}, which passes each branch a
 * fresh copy) — two branches of the same condition may legitimately re-converge
 * on the same downstream node (the ASL equivalent of two `Choice` branches
 * sharing a `Next` state), and since only one branch ever executes at runtime,
 * that shared tail must be emitted into EVERY branch that reaches it, not just
 * the first one processed. Returns the emitted lines, the identifier of the
 * last result-binding node, and whether the chain emitted its own terminal
 * `return`/`throw` (via an `end` node).
 */
function emitChain(
  wf: DarWorkflow,
  startId: string | undefined,
  scope: Scope,
  idents: Map<string, string>,
  byId: Map<string, DarNode>,
  adj: Map<string, DarWorkflow["edges"]>,
  visited: Set<string>,
): {
  lines: string[];
  lastIdent?: string;
  terminated: boolean;
  /**
   * True when the chain stopped because its last node was marked `terminal` (rather
   * than by reaching an `end` node, which sets `terminated`). The distinction matters
   * inside a condition branch: a terminal node's result IS the workflow's result, so
   * the branch must return it rather than `break` out to the scope's trailing return.
   */
  endsAtTerminal: boolean;
} {
  const lines: string[] = [];
  let lastIdent: string | undefined;
  let terminated = false;
  let endsAtTerminal = false;
  let curId = startId;
  while (curId) {
    if (visited.has(curId)) {
      // A revisit within a SINGLE chain is a back-edge — the workflow loops.
      // Branches (conditions, error routes) each get a forked `visited`, so a
      // legitimate reconvergence never lands here; only a real cycle does.
      //
      // Refused rather than tolerated: a durable workflow expresses repetition with a
      // waitForCondition or a map, and treating a back-edge as "stop here" would emit
      // the body once and drop the loop with no diagnostic. `topoSortTasks` refuses the
      // same graph in dag mode, so both modes agree.
      const node = byId.get(curId);
      throw new Error(
        `Cannot generate "${wf.name}": the chain loops back to ` +
          `"${node?.name ?? curId}". A durable workflow expresses repetition with ` +
          `a waitForCondition or a map, not by cycling edges — this graph would ` +
          `otherwise emit its body once and silently drop the loop.`,
      );
    }
    const node = byId.get(curId);
    if (!node) break;
    visited.add(curId);
    if (node.kind === "end") {
      lines.push(nodeMarker(node), emitEnd(node, scope, lastIdent));
      terminated = true;
      break;
    }
    if (node.kind === "start") {
      curId = firstFlowTarget(adj, curId);
      continue;
    }
    if (node.kind === "condition") {
      lines.push(
        nodeMarker(node),
        emitCondition(node, wf, scope, idents, byId, adj, visited),
      );
      lastIdent = undefined; // a switch has no single result to bind/return
      break;
    }
    lines.push(
      nodeMarker(node),
      ...emitOperation(node, wf, scope, idents, byId, adj, visited),
    );
    lastIdent = bindsResult(node.kind)
      ? (idents.get(curId) as string)
      : undefined;
    endsAtTerminal = node.terminal === true;
    curId = firstFlowTarget(adj, curId);
  }
  return { lines, lastIdent, terminated, endsAtTerminal };
}

/**
 * Emits an operation node's statement(s), composing the result binding with its
 * error handling — error **routes** are the node's `"error"`-kind outgoing
 * edges; error **fallbacks** are its {@link DarNode.onError} branches:
 *   - no routes/fallbacks → `const X = <op>;`
 *   - any                 → `let X; try { X = <op>; } catch (err) { <chain> }`
 */
function emitOperation(
  node: DarNode,
  wf: DarWorkflow,
  scope: Scope,
  idents: Map<string, string>,
  byId: Map<string, DarNode>,
  adj: Map<string, DarWorkflow["edges"]>,
  visited: Set<string>,
): string[] {
  const pad = " ".repeat(scope.indent);
  const inner = scope.indent + 2;
  const innerPad = " ".repeat(inner);
  const ident = idents.get(node.id) as string;
  const doesBind = bindsResult(node.kind);
  const hasHandling =
    errorEdgesFor(wf.edges, node.id).length > 0 ||
    ((node.onError as ErrorBranch[] | undefined) ?? []).length > 0;
  const opAtInner = () => emitNode(node, { ...scope, indent: inner });
  // Optional author-declared result type -> `: <Type>` annotation.
  const rt =
    typeof node.resultType === "string" && node.resultType.trim().length > 0
      ? // Parenthesized AND parsed. Parenthesization alone only protects the
        // `const X: (T) = expr;` form, which needs an initializer; the `let
        // ${ident}${rt};` form emitted for nodes with error handling has none,
        // so a payload that closed the parenthesis became a real statement.
        `: (${requireTypeExpression(
          node.resultType,
          "result type",
          `Node "${node.name}"`,
        )})`
      : "";

  // Author comment (ASL Comment equivalent) rides above the operation.
  const commentLines =
    typeof node.comment === "string" && node.comment.trim() !== ""
      ? node.comment
          .trim()
          // Split on EVERY JS line terminator (\r, \u2028, \u2029 included)
          // so a comment can never break out into live code.
          .split(/\r\n?|\n|\u2028|\u2029/)
          .map((l) => `${pad}// ${l}`)
      : [];

  if (!hasHandling) {
    const prefix = doesBind ? `${pad}const ${ident}${rt} = ` : pad;
    return [...commentLines, `${prefix}${emitNode(node, scope)};`];
  }

  const assign = doesBind ? `${ident} = ` : "";
  return [
    ...commentLines,
    ...(doesBind ? [`${pad}let ${ident}${rt};`] : []),
    `${pad}try {`,
    `${innerPad}${assign}${opAtInner()};`,
    `${pad}} catch (err) {`,
    ...emitErrorCatch(
      node,
      ident,
      doesBind,
      wf,
      scope,
      idents,
      byId,
      adj,
      visited,
    ),
    `${pad}}`,
  ];
}

/**
 * Builds the body of a node's `catch (err)` from its error handling:
 *   - **routes** — the node's `"error"`-kind outgoing edges (edge-array order),
 *     each recursing into the target's tail;
 *   - **fallbacks** — {@link DarNode.onError} branches, each assigning a value
 *     produced by an async IIFE (so it can `return`, `await`, and read `err`).
 * Typed entries become an `if (err instanceof <Type>) { … }` chain — routes
 * first, then fallbacks; the catch-all (an edge without `errorType`, or a
 * blank-type fallback) is the `else` (or `throw err` when there is none).
 */
function emitErrorCatch(
  node: DarNode,
  ident: string,
  doesBind: boolean,
  wf: DarWorkflow,
  scope: Scope,
  idents: Map<string, string>,
  byId: Map<string, DarNode>,
  adj: Map<string, DarWorkflow["edges"]>,
  visited: Set<string>,
): string[] {
  const inner = scope.indent + 2; // catch-body indent
  const innerPad = " ".repeat(inner);
  const deep = inner + 2; // if-branch body indent
  const deepPad = " ".repeat(deep);

  // Unify routes (edges) and fallbacks (node branches) into one handler list.
  type Handler = { errorType?: string; target?: string; fallbackCode?: string };
  const routes: Handler[] = errorEdgesFor(wf.edges, node.id).map((e) => ({
    errorType: e.errorType,
    target: e.target,
  }));
  const fallbacks: Handler[] = (
    (node.onError as ErrorBranch[] | undefined) ?? []
  ).map((b) => ({ errorType: b.errorType, fallbackCode: b.fallbackCode }));
  const typed = (h: Handler) => (h.errorType ?? "").trim().length > 0;
  const labeled = [...routes.filter(typed), ...fallbacks.filter(typed)];
  const elseBranch =
    routes.find((h) => !typed(h)) ?? fallbacks.find((h) => !typed(h));

  const emitBranch = (h: Handler, indentSpaces: number): string[] => {
    const bp = " ".repeat(indentSpaces);
    if (h.target) {
      const route = emitChain(
        wf,
        h.target,
        { ...scope, indent: indentSpaces },
        idents,
        byId,
        adj,
        // A FORK of `visited`, exactly as the condition path below does. Sharing
        // it made `visited` — an "already emitted" marker — leak across
        // branches: a node reached from a catch was marked emitted and then
        // skipped on the success path, so a plain try/recover/rejoin shape
        // emitted the rejoin node ONLY inside the catch. With two labeled error
        // branches the second also lost every node the first emitted.
        new Set(visited),
      );
      // The `terminated` flag has to be honoured here, exactly as
      // `emitLinearScope` does. A recovery branch whose chain does NOT end in an
      // end node simply falls out of the catch block, and the OUTER chain then
      // re-emits the same rejoin tail after the try/catch — so on the error path
      // those rejoin nodes ran TWICE. Workflows saved from the Studio happen to be
      // safe because a terminal node owns an end node, but hand-written,
      // LLM-produced and ASL-imported `.dar` files are not, and `parseWorkflow` is
      // deliberately forgiving. Returning the branch's last result closes the
      // block so the tail is emitted once, on the success path only.
      if (route.terminated) return route.lines;
      return [
        ...route.lines,
        `${" ".repeat(indentSpaces)}return ${route.lastIdent ?? "undefined"};`,
      ];
    }
    if (typeof h.fallbackCode === "string") {
      if (!doesBind) return []; // nothing to assign a fallback to
      const code =
        h.fallbackCode.trim().length > 0 ? h.fallbackCode : "return undefined;";
      return [
        `${bp}${ident} = await (async () => {`,
        indent(code, indentSpaces + 2),
        `${bp}})();`,
      ];
    }
    return [`${bp}throw err;`];
  };

  if (labeled.length === 0) {
    return elseBranch
      ? emitBranch(elseBranch, inner)
      : [`${innerPad}throw err;`];
  }

  const lines: string[] = [];
  labeled.forEach((h, i) => {
    const kw = i === 0 ? "if" : "} else if";
    // An errorType may list several classes (ASL Catch ErrorEquals),
    // comma-separated — match any of them. Each must be a plain (dotted)
    // identifier: errorType renders as a small label in the Studio, so raw
    // interpolation would be an invisible code-injection surface.
    const classes = (h.errorType as string)
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    for (const c of classes) {
      if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(c)) {
        throw new Error(
          `Node "${node.name}": error type "${c}" is not a valid error class name.`,
        );
      }
    }
    const cond = classes.map((c) => `err instanceof ${c}`).join(" || ");
    lines.push(`${innerPad}${kw} (${cond}) {`);
    lines.push(...emitBranch(h, deep));
  });
  lines.push(`${innerPad}} else {`);
  lines.push(
    ...(elseBranch ? emitBranch(elseBranch, deep) : [`${deepPad}throw err;`]),
  );
  lines.push(`${innerPad}}`);
  return lines;
}

/**
 * Emits a `condition` node: the branch expression is evaluated inline (a plain,
 * deterministic decision — no checkpoint), then a `switch` routes to each
 * branch. Per the SDK replay model, code outside steps must be deterministic,
 * so a pure decision over upstream (already-checkpointed) results is safe and
 * avoids the cost + latency of an extra step/checkpoint. If a decision needs
 * non-deterministic or I/O input, compute that in a step node upstream and
 * branch on its result. Each outgoing flow edge with a `match` becomes a `case`
 * (recursing into that branch's tail); a matchless edge is the `default`.
 */
function emitCondition(
  node: DarNode,
  wf: DarWorkflow,
  scope: Scope,
  idents: Map<string, string>,
  byId: Map<string, DarNode>,
  adj: Map<string, DarWorkflow["edges"]>,
  visited: Set<string>,
): string {
  const pad = " ".repeat(scope.indent);
  const inner = scope.indent + 2;
  const ident = idents.get(node.id) as string;
  const body =
    typeof node.code === "string" && node.code.trim().length > 0
      ? node.code
      : 'return "DEFAULT";';
  const lines: string[] = [
    `${pad}const ${ident} = (() => {`,
    indent(bodyStartMarker(), inner),
    indent(body, inner),
    indent(bodyEndMarker(), inner),
    `${pad}})();`,
    `${pad}switch (${ident}) {`,
  ];
  const branchScope: Scope = { ...scope, indent: inner + 2 };
  /** A switch may carry only one `default:` clause. */
  let sawDefault = false;
  for (const edge of adj.get(node.id) ?? []) {
    if (edge.kind === "error") continue; // error routes are not branches
    const match = typeof edge.match === "string" ? edge.match.trim() : "";
    // Each branch gets its OWN copy of `visited` (seeded from the outer
    // scope's progress so far): two branches of the same condition can
    // legitimately re-converge on the same downstream node (the ASL
    // equivalent of two Choice branches sharing a `Next` state) — since only
    // one branch ever runs at a time, re-emitting that shared tail into each
    // branch's `case` is safe (no double-execution risk) and is exactly what
    // must happen for the shared node's code to appear in BOTH branches. A
    // single set shared across branches would instead mark the node visited
    // after the first branch emits it, silently dropping it from every
    // subsequent branch that also reaches it (a real bug, fixed here).
    const tail = emitChain(
      wf,
      edge.target,
      branchScope,
      idents,
      byId,
      adj,
      new Set(visited),
    );
    if (match.length === 0) {
      // Two matchless outgoing edges emitted two `default:` clauses in one switch,
      // which is a syntax error the user met as an opaque esbuild failure instead of
      // a message naming the node.
      if (sawDefault) {
        throw new Error(
          `Condition node "${node.name}" has more than one outgoing edge without ` +
            `a match value. Only one default branch is possible — label the ` +
            `others, or remove the extra edge.`,
        );
      }
      sawDefault = true;
    }
    const head =
      match.length > 0
        ? `${pad}  case ${JSON.stringify(match)}: {`
        : `${pad}  default: {`;
    // A tail that already returns/throws (reached an end node) needs no break.
    //
    // Otherwise: if the branch ENDED because its last node was terminal, its result is
    // the workflow's result, so return it. Emitting `break` there dropped the value —
    // execution fell out of the switch to the scope's trailing `return undefined`, so
    // a condition whose branches end in terminal steps computed both results and
    // returned neither. Studio-saved workflows are unaffected because a terminal node
    // owns an end node, which takes the branch above; hand-written, LLM-produced and
    // ASL-imported files are not, and parseWorkflow is deliberately forgiving.
    const tailEnd = tail.terminated
      ? []
      : tail.endsAtTerminal
        ? [`${pad}    return ${tail.lastIdent ?? "undefined"};`]
        : [`${pad}    break;`];
    lines.push(head, ...tail.lines, ...tailEnd, `${pad}  }`);
  }
  lines.push(`${pad}}`);
  return lines.join("\n");
}

/**
 * Emits a workflow scope's statements, dispatching on the scope's
 * `dependencyMode` (design §4.4). `"dag"` scopes go through {@link emitDagScope}
 * (a `context.dag(...)` container of name-keyed tasks); every other value —
 * including the default `"linear"` — goes through {@link emitLinearScope}, the
 * original single-spine emitter, whose behaviour is UNCHANGED.
 *
 * The dispatch is per-scope, so the two conventions compose recursively: a
 * `dag` scope may hold a container whose body is `linear` (its child body emits
 * via {@link emitLinearScope}), and a `linear` scope may hold a container whose
 * body is `dag` (its child body emits a nested `ctx.dag(...)` via
 * {@link emitDagScope}) — they meet only at the container wall (§4.4).
 */
function emitBody(wf: DarWorkflow, scope: Scope): string {
  return wf.dependencyMode === "dag"
    ? emitDagScope(wf, scope)
    : emitLinearScope(wf, scope);
}

/**
 * Emits a LINEAR (`dependencyMode !== "dag"`) workflow scope's statements plus a
 * trailing `return` of the last bound result (or `undefined`), each line
 * indented to `scope.indent`. Used for the top-level handler and every
 * container/branch body in linear mode. This is the original `emitBody` body,
 * unchanged; only the dispatch in {@link emitBody} is new.
 */
function emitLinearScope(wf: DarWorkflow, scope: Scope): string {
  const idents = buildIdentifierMap(wf.nodes);
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const adj = edgesBySource(wf);
  const start = wf.nodes.find((n) => n.kind === "start") ?? wf.nodes[0];
  const { lines, lastIdent, terminated } = emitChain(
    wf,
    start?.id,
    scope,
    idents,
    byId,
    adj,
    new Set<string>(),
  );
  const pad = " ".repeat(scope.indent);
  // The chain already ended with an end node's return/throw — don't add one.
  if (terminated) return lines.join("\n");
  const ret = lastIdent
    ? `${pad}return ${lastIdent};`
    : `${pad}return undefined;`;
  return [...lines, ret].join("\n");
}

/* ========================================================================== *
 *  DAG scope emitter (design §§3, 4, 6; Phase 2 items P2.1–P2.11).
 *
 *  Structurally simpler than the linear spine: rather than walking one edge
 *  per node, it ENUMERATES the scope's operation nodes in topological order
 *  and emits, for each, a name-keyed task registration
 *  (`const <ident> = dag.<kind>("<name>", [<deps>], <body>, <config>)`) inside
 *  a `<ctx>.dag("<scope>", (dag) => { … })` container. Data flows through the
 *  SDK's `deps` map (keyed by task NAME), reconciled with the identifier-based
 *  authoring model by injecting a `const <ident> = deps["<name>"]` shim at the
 *  top of each task body (design §3) — so an author's verbatim code block is
 *  BYTE-IDENTICAL between linear and dag mode.
 *
 *  Verified against the shipped SDK surface (`dag-context.ts` / `dag.ts`):
 *    - `dag.step(name, deps, fn, cfg?)`               deps = arg 2
 *    - `dag.invoke(name, funcId, deps, payloadFn, cfg?)` deps = arg 3
 *    - `dag.callback(name, deps, submitter, cfg?)`
 *    - `dag.wait(name, deps, duration, cfg?)`
 *    - `dag.waitForCondition(name, deps, check, cfg)`
 *    - `dag.runInChildContext(name, deps, fn, cfg?)`
 *    - `dag.map(name, deps, items, mapFunc, cfg?)`
 *    - `dag.parallel(name, deps, branches, cfg?)`
 *    - `dag.dag(name, deps, register, cfg?)`
 *  The deps CALLBACK receives `(deps, <native…>)` only when `deps` is
 *  non-empty, else the native shape — matched here on the emitted deps-array
 *  length. Ordering-only deps use the handle builder `.after(...)`, and the
 *  per-task trigger rule uses `.triggerRule("X")` — NEITHER lives in the config
 *  object (`ConditionalConfig` carries only `runIf`); both are chained on the
 *  returned {@link TaskHandle}.
 * ========================================================================== */

/**
 * The classified incoming dependencies of a dag task, split by how each
 * incoming edge feeds the task (design §§3, 4.1, 4.3, 5):
 *   - `arraySources` — every non-error, non-ordering source, in edge order,
 *     de-duplicated: the handles that go in the `[…]` deps array (so they land
 *     in the SDK `DepsMap`). Includes `condition` sources (needed by `runIf`).
 *   - `resultSources` — the subset of `arraySources` that get a `const … =
 *     deps["…"]` shim (plain result edges; NOT `condition` sources, whose value
 *     is a routing token consumed by `runIf`, not the body).
 *   - `afterSources` — ordering-only (`dependencyKind: "ordering"`) and
 *     catch-all error sources: the SDK's `.after(...)` handle builder; no shim.
 *   - `runIfClauses` — boolean expressions contributed by incoming `condition`
 *     edges (`match` → equality; matchless → negated-includes, §4.1).
 *   - `forceAnyFailed` — a catch-all error edge is present, so the task must
 *     run ON failure of its source → trigger rule `ANY_FAILED` (§4.3).
 */
interface DagIncoming {
  arraySources: DarNode[];
  resultSources: DarNode[];
  afterSources: DarNode[];
  runIfClauses: string[];
  forceAnyFailed: boolean;
}

/** The `match` values on a condition node's outgoing flow edges (trimmed, non-blank). */
function conditionMatches(condId: string, wf: DarWorkflow): string[] {
  const out: string[] = [];
  for (const e of wf.edges) {
    if (e.source !== condId || e.kind === "error") continue;
    const m = typeof e.match === "string" ? e.match.trim() : "";
    if (m.length > 0) out.push(m);
  }
  return out;
}

/**
 * Classifies a node's incoming edges into {@link DagIncoming}. Throws a clear
 * codegen error on a TYPED error edge (unsupported in dag mode — steer to an
 * `onError` fallback, §4.3). Deterministic: sources keep first-seen edge order.
 */
function classifyIncoming(
  node: DarNode,
  wf: DarWorkflow,
  byId: Map<string, DarNode>,
): DagIncoming {
  const arraySources: DarNode[] = [];
  const arraySeen = new Set<string>();
  const resultSources: DarNode[] = [];
  const afterSources: DarNode[] = [];
  const afterSeen = new Set<string>();
  const runIfClauses: string[] = [];
  let forceAnyFailed = false;

  for (const e of wf.edges) {
    if (e.target !== node.id) continue;
    const src = byId.get(e.source);
    // A `start` node is not a task: an edge from it just marks a root task
    // (`deps: []`), never a dependency.
    if (!src || src.kind === "start") continue;

    if (e.kind === "error") {
      const errorType =
        typeof e.errorType === "string" ? e.errorType.trim() : "";
      if (errorType.length > 0) {
        throw new Error(
          `Node "${node.name}": a typed error edge (errorType ${JSON.stringify(
            errorType,
          )}) is not supported in dag mode — trigger rules have no error-class ` +
            `discrimination. Use an onError fallback on "${src.name}" for typed ` +
            `recovery (design §4.3).`,
        );
      }
      if (!afterSeen.has(e.source)) {
        afterSeen.add(e.source);
        afterSources.push(src);
      }
      forceAnyFailed = true;
      continue;
    }

    if (src.kind === "condition") {
      if (!arraySeen.has(e.source)) {
        arraySeen.add(e.source);
        arraySources.push(src);
      }
      const key = JSON.stringify(src.name);
      const match = typeof e.match === "string" ? e.match.trim() : "";
      if (match.length > 0) {
        runIfClauses.push(`deps[${key}] === ${JSON.stringify(match)}`);
      } else {
        const others = conditionMatches(src.id, wf).map((m) =>
          JSON.stringify(m),
        );
        runIfClauses.push(
          `![${others.join(", ")}].includes(deps[${key}] as string)`,
        );
      }
      continue;
    }

    // Plain flow edge (non-error, non-condition-source): result vs. ordering is
    // auto-inferred from whether THIS node's code references the source, unless
    // the edge carries an explicit `dependencyKind` override (design §5). The
    // shared helper keeps this decision identical to the Studio canvas.
    const kind = inferDependencyKind({
      targetNode: node as unknown as Record<string, unknown>,
      sourceName: src.name,
      explicit: e.dependencyKind,
    });
    if (kind === "ordering") {
      if (!afterSeen.has(e.source)) {
        afterSeen.add(e.source);
        afterSources.push(src);
      }
      continue;
    }

    // Result edge: array + shim (de-duplicated on source id).
    if (!arraySeen.has(e.source)) {
      arraySeen.add(e.source);
      arraySources.push(src);
      resultSources.push(src);
    }
  }

  return {
    arraySources,
    resultSources,
    afterSources,
    runIfClauses,
    forceAnyFailed,
  };
}

/**
 * Deterministic topological order of a scope's task nodes (everything except
 * `start`/`end`). Every non-error and catch-all-error edge makes its target
 * depend on its source, so a handle `const` is always declared before it is
 * referenced (design §6). Repeatedly takes the FIRST still-unemitted node (in
 * `wf.nodes` order) with no unemitted dependency — stable and byte-deterministic.
 * Throws a clear codegen error if a cycle remains (validation guarantees
 * acyclicity in a later phase, but codegen must never silently loop, P2.3).
 */
function topoSortTasks(
  taskNodes: DarNode[],
  wf: DarWorkflow,
  byId: Map<string, DarNode>,
): DarNode[] {
  const isTask = new Set(taskNodes.map((n) => n.id));
  // target id -> set of source ids it depends on (both must be tasks).
  const deps = new Map<string, Set<string>>();
  for (const n of taskNodes) deps.set(n.id, new Set());
  for (const e of wf.edges) {
    if (!isTask.has(e.source) || !isTask.has(e.target)) continue;
    if (e.source === e.target) continue; // self-loops handled by cycle check
    deps.get(e.target)?.add(e.source);
  }
  const ordered: DarNode[] = [];
  const emitted = new Set<string>();
  while (ordered.length < taskNodes.length) {
    const next = taskNodes.find(
      (n) =>
        !emitted.has(n.id) &&
        [...(deps.get(n.id) as Set<string>)].every((d) => emitted.has(d)),
    );
    if (!next) {
      const remaining = taskNodes
        .filter((n) => !emitted.has(n.id))
        .map((n) => n.name);
      throw new Error(
        `Cannot generate a dag scope for "${wf.name}": a dependency cycle ` +
          `remains among tasks [${remaining.join(", ")}]. A DAG must be acyclic.`,
      );
    }
    ordered.push(next);
    emitted.add(next.id);
  }
  return ordered;
}

/** A validated {@link TriggerRule} literal, or throws on an unknown rule. */
function validateTriggerRule(rule: unknown, nodeName: string): TriggerRule {
  if (
    typeof rule === "string" &&
    (TRIGGER_RULES as readonly string[]).includes(rule)
  ) {
    return rule as TriggerRule;
  }
  throw new Error(
    `Node "${nodeName}": unknown triggerRule ${JSON.stringify(rule)}. ` +
      `Expected one of ${TRIGGER_RULES.join(", ")}.`,
  );
}

/**
 * The `runIf: (deps) => …` config fragment for a task, ANDing the condition
 * -lowering clauses (§4.1) with the node's own `runIf` expression, or "" when
 * neither is present. Each clause is parenthesized so the `&&` composition is
 * unambiguous; the node's `runIf` is author TypeScript spliced verbatim (same
 * trust model as a step body), the condition clauses are built from
 * `JSON.stringify`d literals (injection-safe).
 */
function dagRunIfField(node: DarNode, incoming: DagIncoming): string {
  const clauses = [...incoming.runIfClauses];
  const own =
    typeof node.runIf === "string"
      ? requireExpression(node.runIf, "runIf", `Node "${node.name}"`)
      : "";
  if (own.length > 0) clauses.push(own);
  if (clauses.length === 0) return "";
  return `runIf: (deps) => ${clauses.map((c) => `(${c})`).join(" && ")}`;
}

/**
 * The `.after(...).triggerRule("…")` builder chain for a task, or "". Ordering
 * and catch-all-error sources become `.after(...)`; an explicit `node.triggerRule`
 * wins, else a catch-all error edge forces `ANY_FAILED` (§4.3).
 */
function dagTrailing(
  node: DarNode,
  incoming: DagIncoming,
  idents: Map<string, string>,
): string {
  let chain = "";
  if (incoming.afterSources.length > 0) {
    chain += `.after(${incoming.afterSources
      .map((n) => idents.get(n.id))
      .join(", ")})`;
  }
  let rule: TriggerRule | undefined;
  if (node.triggerRule !== undefined) {
    rule = validateTriggerRule(node.triggerRule, node.name);
  } else if (incoming.forceAnyFailed) {
    rule = "ANY_FAILED";
  }
  if (rule) chain += `.triggerRule(${JSON.stringify(rule)})`;
  return chain;
}

/** The `[<handle idents>]` deps-array literal for a task. */
function depsArrayLiteral(
  incoming: DagIncoming,
  idents: Map<string, string>,
): string {
  return `[${incoming.arraySources.map((n) => idents.get(n.id)).join(", ")}]`;
}

/** The injected `const <ident> = deps["<name>"];` shim lines, at `indentSpaces`. */
function dagShimLines(
  incoming: DagIncoming,
  idents: Map<string, string>,
  indentSpaces: number,
): string[] {
  const pad = " ".repeat(indentSpaces);
  return incoming.resultSources.map(
    (src) =>
      `${pad}const ${idents.get(src.id)} = deps[${JSON.stringify(src.name)}];`,
  );
}

/**
 * Wraps a task's inner content in the shim + (optional) `onError` fallback
 * recovery (design §4.3). `buildContent(indent)` produces the operation's inner
 * lines AT the given indent (verbatim step body + markers, an `emitBody` child
 * scope, an AWS SDK call, …). When the node has `onError` branches they become
 * a task-local `try { … } catch (err) { <instanceof chain> }` INSIDE the
 * closure, after the shim — preserving typed value recovery; each fallback
 * block `return`s the task result. The shim sits OUTSIDE the try (so a fallback
 * can read the deps too) and OUTSIDE the body markers (it has no `.dar.ts`
 * counterpart), keeping the source map correct.
 */
function dagClosureBody(
  node: DarNode,
  bodyIndent: number,
  incoming: DagIncoming,
  idents: Map<string, string>,
  buildContent: (indent: number) => string[],
): string[] {
  const shim = dagShimLines(incoming, idents, bodyIndent);
  const branches = (node.onError as ErrorBranch[] | undefined) ?? [];
  if (branches.length === 0) {
    return [...shim, ...buildContent(bodyIndent)];
  }
  const pad = " ".repeat(bodyIndent);
  return [
    ...shim,
    `${pad}try {`,
    ...buildContent(bodyIndent + 2),
    `${pad}} catch (err) {`,
    ...dagOnErrorChain(node, branches, bodyIndent + 2),
    `${pad}}`,
  ];
}

/**
 * The body of a dag task's `catch (err)` from its {@link DarNode.onError}
 * fallbacks — a typed `if (err instanceof <Type>) { … }` chain (each `fallbackCode`
 * block `return`s the task result), with the catch-all (blank-type) fallback as
 * the `else`, or `throw err` when there is none. Mirrors the linear
 * {@link emitErrorCatch} fallback path (and reuses its error-class whitelist),
 * minus the assignment/route machinery — a dag task's closure returns directly.
 */
function dagOnErrorChain(
  node: DarNode,
  branches: ErrorBranch[],
  indentSpaces: number,
): string[] {
  const pad = " ".repeat(indentSpaces);
  const deep = indentSpaces + 2;
  const deepPad = " ".repeat(deep);
  const typed = (b: ErrorBranch) => (b.errorType ?? "").trim().length > 0;
  const labeled = branches.filter(typed);
  const catchAll = branches.find((b) => !typed(b));
  const fallbackCode = (b: ErrorBranch) =>
    (b.fallbackCode ?? "").trim().length > 0
      ? (b.fallbackCode as string)
      : "return undefined;";

  if (labeled.length === 0) {
    return catchAll
      ? [indent(fallbackCode(catchAll), indentSpaces)]
      : [`${pad}throw err;`];
  }

  const lines: string[] = [];
  labeled.forEach((b, i) => {
    const kw = i === 0 ? "if" : "} else if";
    const classes = (b.errorType as string)
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    for (const c of classes) {
      if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(c)) {
        throw new Error(
          `Node "${node.name}": error type "${c}" is not a valid error class name.`,
        );
      }
    }
    const cond = classes.map((c) => `err instanceof ${c}`).join(" || ");
    lines.push(`${pad}${kw} (${cond}) {`);
    lines.push(indent(fallbackCode(b), deep));
  });
  lines.push(`${pad}} else {`);
  lines.push(
    catchAll ? indent(fallbackCode(catchAll), deep) : `${deepPad}throw err;`,
  );
  lines.push(`${pad}}`);
  return lines;
}

/**
 * The DAG-level `, { … }` config suffix from a workflow's {@link DagConfigSpec}
 * (design §5), mapping straight onto the SDK's `DagConfig`: `maxConcurrency`,
 * `defaultTriggerRule`, `nesting` (→ `NestingType.<KIND>`), and
 * `completionConfig` (threshold counts, or a custom `shouldComplete` predicate
 * body). Trigger rules and nesting are whitelisted (they become code tokens);
 * numeric fields are validated finite. Returns "" for an absent/empty config.
 */
function emitDagConfigSuffix(
  cfg: DagConfigSpec | undefined,
  imports: Set<string>,
): string {
  return configSuffix(dagConfigFields(cfg, imports));
}

/** The individual `DagConfig` field fragments (see {@link emitDagConfigSuffix}). */
function dagConfigFields(
  cfg: DagConfigSpec | undefined,
  imports: Set<string>,
): string[] {
  if (!cfg || typeof cfg !== "object") return [];
  const fields: string[] = [];
  if (
    typeof cfg.maxConcurrency === "number" &&
    Number.isFinite(cfg.maxConcurrency)
  ) {
    fields.push(`maxConcurrency: ${cfg.maxConcurrency}`);
  }
  if (cfg.defaultTriggerRule !== undefined) {
    const rule = validateTriggerRule(cfg.defaultTriggerRule, "dagConfig");
    fields.push(`defaultTriggerRule: ${JSON.stringify(rule)}`);
  }
  if (cfg.nesting === "FLAT" || cfg.nesting === "NESTED") {
    imports.add("NestingType");
    fields.push(`nesting: NestingType.${cfg.nesting}`);
  }
  const cc = emitDagCompletionConfig(cfg.completionConfig);
  if (cc) fields.push(cc);
  return fields;
}

/** `completionConfig: { … }` from a {@link DagCompletionConfigSpec}, or "". */
function emitDagCompletionConfig(
  cc: DagCompletionConfigSpec | undefined,
): string {
  if (!cc || typeof cc !== "object") return "";
  if (typeof (cc as { shouldComplete?: unknown }).shouldComplete === "string") {
    const body = requireExpression(
      (cc as { shouldComplete: string }).shouldComplete,
      "shouldComplete",
      "DAG completion config",
    );
    return `completionConfig: { shouldComplete: (status) => ${body} }`;
  }
  const t = cc as {
    minSuccessful?: number;
    toleratedFailureCount?: number;
    toleratedFailurePercentage?: number;
  };
  const parts: string[] = [];
  if (typeof t.minSuccessful === "number")
    parts.push(`minSuccessful: ${t.minSuccessful}`);
  if (typeof t.toleratedFailureCount === "number")
    parts.push(`toleratedFailureCount: ${t.toleratedFailureCount}`);
  if (typeof t.toleratedFailurePercentage === "number")
    parts.push(`toleratedFailurePercentage: ${t.toleratedFailurePercentage}`);
  return parts.length > 0 ? `completionConfig: { ${parts.join(", ")} }` : "";
}

/**
 * The single reserved identifier for a dag scope's aggregate result const
 * (`const result = await <ctx>.dag(…)`). Matches the design's `end`-node
 * authoring convention (§5: `result.getResult(…)` / `result.throwIfError()`).
 */
const DAG_RESULT_IDENT = "result";

/**
 * Emits a DAG (`dependencyMode === "dag"`) scope: a `<ctx>.dag("<name>",
 * (dag) => { … }, <dagConfig?>)` container of topologically-ordered, name-keyed
 * task registrations, followed by the `end`-node-driven return over the
 * aggregate {@link DagResult} (P2.2, P2.10). Composes recursively with the
 * linear emitter through {@link emitBody} (§4.4).
 */
/**
 * Whether DAG codegen is permitted for this process.
 *
 * ⚠️ DAG mode emits an API THE RUNTIME SDK DOES NOT HAVE YET: `context.dag(...)`,
 * the `dag.*` task builders, `.after()`, `.triggerRule()`, the `deps` closure
 * parameter, and the `DagResult` returned at the end. `NestingType` happens to
 * exist; nothing else on that list does.
 *
 * Nothing catches this downstream, which is why it has to be caught here.
 * `NodejsFunction` bundles with esbuild, which transpiles without typechecking,
 * so both synth and bundle succeed and the failure surfaces only when the
 * deployed function is invoked — as `TypeError: context.dag is not a function`.
 * The DAG codegen tests assert on generated STRINGS, so they stay green too.
 *
 * The gate lives in {@link emitDagRegistrations}, which is where it belongs: it is
 * the ONLY function that emits dag task registrations, so all three callers reach
 * it — a workflow whose own dependencyMode is "dag" (via emitDagScope), a
 * `dagContainer` inside a LINEAR workflow, and a `dagContainer` nested inside
 * another dag scope.
 *
 * It was originally placed on emitDagScope, with a comment claiming that was the
 * single chokepoint. That was wrong: the linear emitter's `dagContainer` arm calls
 * emitDagRegistrations directly and emitted `await ctx.dag(...)` without ever
 * reaching the gate — so dragging "DAG Container" from the palette produced
 * exactly the undeployable workflow the gate exists to prevent. Entry-point
 * reasoning is what failed there; gating the one function that emits the calls
 * cannot miss a path.
 *
 * Enable it deliberately (to develop against an SDK build that has the runtime)
 * via `allowDagMode` in {@link GenerateHandlerOptions}, or the
 * `DAR_ALLOW_DAG_MODE=1` environment variable for tests and scripts. Remove this
 * gate when the runtime lands, and replace it with a test that INVOKES a
 * generated handler against the real SDK — that is what would have caught this.
 */
function dagModeAllowed(opts: GenerateHandlerOptions | undefined): boolean {
  if (opts?.allowDagMode === true) return true;
  // The environment opt-in exists for this repo's own tests and scripts. Honouring
  // it unconditionally would also open the gate during a REAL cdk synth for anyone
  // who happened to have the variable exported, which is not a decision an
  // environment variable should be able to make. Restricted to a test runner; a
  // deliberate consumer passes `allowDagMode` explicitly.
  const underTestRunner =
    process.env.JEST_WORKER_ID !== undefined || process.env.NODE_ENV === "test";
  return process.env.DAR_ALLOW_DAG_MODE === "1" && underTestRunner;
}

/** Thrown by {@link generateHandler} when a workflow needs the unlanded runtime. */
export class DagModeUnsupportedError extends Error {
  constructor(workflowName: string) {
    super(
      `Workflow "${workflowName}" uses dag dependency mode, which cannot be ` +
        `deployed yet: the generated code calls context.dag(...) and the dag task ` +
        `builders, and the durable-execution SDK does not implement them. A ` +
        `deployed function would fail at invoke time with "context.dag is not a ` +
        `function". Convert the workflow to linear mode, or set allowDagMode if ` +
        `you are building against an SDK that has the dag runtime.`,
    );
    this.name = "DagModeUnsupportedError";
  }
}

function emitDagScope(wf: DarWorkflow, scope: Scope): string {
  const idents = buildIdentifierMap(wf.nodes);
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  // No local check that a node sanitizes to `result` (which would shadow the DagResult
  // const): "result" is in RESERVED_IDENTIFIERS, so buildIdentifierMap above has already
  // raised the rename error.
  const pad = " ".repeat(scope.indent);
  const regs = emitDagRegistrations(
    wf,
    { ...scope, indent: scope.indent + 2 },
    "dag",
    idents,
    byId,
  );
  const cfg = emitDagConfigSuffix(
    wf.dagConfig as DagConfigSpec | undefined,
    scope.imports,
  );
  return [
    `${pad}const ${DAG_RESULT_IDENT} = await ${scope.ctxVar}.dag(${JSON.stringify(
      wf.name,
    )}, (dag) => {`,
    ...regs,
    `${pad}}${cfg});`,
    emitDagEnd(scope),
  ].join("\n");
}

/**
 * Emits the task registrations inside a `(dag) => { … }` callback: the scope's
 * operation nodes (everything but `start`/`end`) in topological order, each
 * preceded by its {@link nodeMarker}. `inline` nodes are rejected here (§4.2).
 * Shared by the top-level {@link emitDagScope} and a nested `dag.dag(...)` task.
 */
function emitDagRegistrations(
  wf: DarWorkflow,
  scope: Scope,
  dagVar: string,
  idents: Map<string, string>,
  byId: Map<string, DarNode>,
): string[] {
  // The gate for the whole dag feature. This is the only function that emits dag
  // task registrations, so every path that would call the unlanded runtime passes
  // through here — including a `dagContainer` in an otherwise LINEAR workflow,
  // which bypassed the earlier placement on emitDagScope entirely.
  if (!dagModeAllowed(scope.opts)) {
    throw new DagModeUnsupportedError(wf.name);
  }
  const taskNodes = wf.nodes.filter(
    (n) => n.kind !== "start" && n.kind !== "end",
  );
  for (const n of taskNodes) {
    if (n.kind === "inline") {
      throw new Error(
        `inline node "${n.name}" is not allowed in a dag scope: DAG tasks are ` +
          `checkpointed operations and there is no dag.inline. Fold this logic ` +
          `into the consuming task, or use a step (design §4.2).`,
      );
    }
  }
  const ordered = topoSortTasks(taskNodes, wf, byId);
  const out: string[] = [];
  for (const node of ordered) {
    out.push(
      nodeMarker(node),
      ...emitDagTask(node, wf, scope, dagVar, idents, byId),
    );
  }
  return out;
}

/**
 * Emits a single dag task registration `const <ident> = dag.<method>("<name>",
 * [<deps>], <body/payload/items/branches>, <config>)<.after><.triggerRule>;`
 * for any of the nine task kinds (plus the lowered `condition`). Reuses the
 * verbatim-body markers, retry/wait-strategy emitters, value/duration
 * whitelists, and completion-config helper shared with the linear emitter.
 */
/**
 * Refuses a closure that references an upstream task's result where the `deps`
 * shim cannot reach.
 *
 * In dag mode an upstream task is a TaskHandle, and the VALUE only appears inside
 * a closure that receives `deps` (see {@link dagShimLines}). `group` gets that
 * closure; a `map` ITERATEE and a `parallel` BRANCH do not — their signatures
 * (`(ctx, item, index)` and `(ctx)`) come from the SDK's existing map/parallel and
 * have no deps parameter. So `return Up;` inside one of them compiled fine and
 * silently handed the user the HANDLE instead of the value.
 *
 * We cannot fix that by inventing a parameter, because the dag runtime does not
 * exist yet (see `dagModeAllowed`) and its callback shapes are not settled. What
 * we can do is refuse, so nobody gets code that runs and quietly operates on the
 * wrong object. Whoever lands the runtime should decide how deps reach a nested
 * closure and then delete this guard.
 */
function refuseUnbindableUpstreamRefs(
  node: DarNode,
  incoming: DagIncoming,
  idents: Map<string, string>,
  bodyText: string,
  where: string,
): void {
  for (const src of incoming.resultSources) {
    const ident = idents.get(src.id);
    if (!ident) continue;
    if (new RegExp(`\\b${ident}\\b`).test(bodyText)) {
      throw new Error(
        `Node "${node.name}": ${where} references upstream result "${ident}", ` +
          `but a ${where} receives no deps parameter, so "${ident}" would be the ` +
          `task handle rather than its value — the generated code would run and ` +
          `silently use the wrong object. Pass the value in through the map items ` +
          `expression, or restructure using a group task.`,
      );
    }
  }
}

/**
 * Refuses `onError` on a dag arm that cannot honour it.
 *
 * Only {@link dagClosureBody} emits the `try`/`catch` from a node's `onError`
 * fallbacks, and `map`, `parallel`, `wait` and `dagContainer` all bypass it — so
 * their fallbacks were dropped silently and a dag workflow FAILED where the
 * identical linear workflow recovers. `dagContainer` even honours `runIf`, which
 * is what makes the omission look accidental rather than intended.
 *
 * These are not all fixable the same way: a `wait` has no closure to wrap, and a
 * `dagContainer`'s callback only REGISTERS its child tasks, so a try/catch around
 * it would catch registration errors rather than execution errors — wrapping it
 * would give a false sense of recovery. Since the runtime is still unlanded,
 * refuse rather than pretend.
 */
function refuseDroppedOnError(node: DarNode, why: string): void {
  const branches = (node.onError as ErrorBranch[] | undefined) ?? [];
  if (branches.length === 0) return;
  throw new Error(
    `Node "${node.name}": onError is not supported on a dag ${node.kind} task ` +
      `(${why}). The fallbacks would be dropped silently, so this workflow would ` +
      `fail where the same workflow in linear mode recovers. Move the error ` +
      `handling into the task body, or use a group task.`,
  );
}

function emitDagTask(
  node: DarNode,
  wf: DarWorkflow,
  scope: Scope,
  dagVar: string,
  idents: Map<string, string>,
  byId: Map<string, DarNode>,
): string[] {
  const pad = " ".repeat(scope.indent);
  const inner = scope.indent + 2;
  const ident = idents.get(node.id) as string;
  const name = JSON.stringify(node.name);
  const { imports } = scope;
  const incoming = classifyIncoming(node, wf, byId);
  const depsArr = depsArrayLiteral(incoming, idents);
  const hasDeps = incoming.arraySources.length > 0;
  const runIf = dagRunIfField(node, incoming);
  const trailing = dagTrailing(node, incoming, idents);

  // Author comment (ASL Comment equivalent) rides above the task, exactly as
  // in the linear emitter.
  const commentLines =
    typeof node.comment === "string" && node.comment.trim() !== ""
      ? node.comment
          .trim()
          .split(/\r\n?|\n|\u2028|\u2029/)
          .map((l) => `${pad}// ${l}`)
      : [];

  const head = (open: string): string =>
    `${pad}const ${ident} = ${dagVar}.${open}`;
  const close = (configFields: string[]): string =>
    `${pad}}${configSuffix(configFields)})${trailing};`;

  switch (node.kind) {
    case "step":
    case "condition": {
      // A `condition` decision is a real checkpointed step returning the branch
      // expression (§4.1); its downstream `match` edges become `runIf`s on the
      // target tasks (handled in classifyIncoming for THOSE tasks).
      const fallback =
        node.kind === "condition" ? 'return "DEFAULT";' : "return undefined;";
      const body =
        typeof node.code === "string" && node.code.trim().length > 0
          ? node.code
          : fallback;
      const buildContent = (i: number) => [
        indent(bodyStartMarker(), i),
        indent(body, i),
        indent(bodyEndMarker(), i),
      ];
      // A plain `condition` decision needs no retry (deterministic routing over
      // already-checkpointed results); a `step` carries its retry strategy.
      const config =
        node.kind === "condition"
          ? [runIf]
          : [
              `retryStrategy: ${emitRetryStrategy(retrySpecOf(node), imports)}`,
              runIf,
            ];
      return [
        ...commentLines,
        head(
          `step(${name}, ${depsArr}, ${hasDeps ? "async (deps, stepCtx) => {" : "async (stepCtx) => {"}`,
        ),
        ...dagClosureBody(node, inner, incoming, idents, buildContent),
        close(config),
      ];
    }
    case "awsSdkCall": {
      const clientPackage =
        typeof node.clientPackage === "string" ? node.clientPackage : "";
      const clientClassRaw =
        typeof node.clientClass === "string" ? node.clientClass : "";
      const commandRaw = typeof node.command === "string" ? node.command : "";
      if (!clientPackage || !clientClassRaw || !commandRaw) {
        throw new Error(
          `awsSdkCall node "${node.name}" is missing clientPackage/clientClass/command.`,
        );
      }
      // Interpolated into a `new X()` call AND an import list. Today an injected
      // import list happens to break the parse, but that is an accident of
      // formatting, not a control.
      const clientClass = requireIdentifier(
        clientClassRaw,
        "client class",
        node.name,
      );
      const command = requireIdentifier(commandRaw, "command", node.name);
      imports.add(
        `@sdk|${requireSdkClientPackage(clientPackage, `node "${node.name}"`)}|${clientClass}|${command}`,
      );
      const input = emitValue(node.input, "{}", "input", `node "${node.name}"`);
      const region =
        typeof node.region === "string" && node.region.trim().length > 0
          ? `{ region: ${JSON.stringify(node.region.trim())} }`
          : "{}";
      const buildContent = (i: number) => {
        const p = " ".repeat(i);
        return [
          `${p}const client = new ${clientClass}(${region});`,
          `${p}return await client.send(new ${command}(${input} as never));`,
        ];
      };
      const config = [
        `retryStrategy: ${emitRetryStrategy(retrySpecOf(node), imports)}`,
        runIf,
      ];
      return [
        ...commentLines,
        head(
          `step(${name}, ${depsArr}, ${hasDeps ? "async (deps, stepCtx) => {" : "async (stepCtx) => {"}`,
        ),
        ...dagClosureBody(node, inner, incoming, idents, buildContent),
        close(config),
      ];
    }
    case "httpCall": {
      // DAG-mode twin of the linear `httpCall` case above.
      const buildContent = (i: number) => httpCallLines(node, i);
      const config = [
        `retryStrategy: ${emitRetryStrategy(retrySpecOf(node), imports)}`,
        runIf,
      ];
      return [
        ...commentLines,
        head(
          `step(${name}, ${depsArr}, ${hasDeps ? "async (deps, stepCtx) => {" : "async (stepCtx) => {"}`,
        ),
        ...dagClosureBody(node, inner, incoming, idents, buildContent),
        close(config),
      ];
    }
    case "chainInvoke": {
      const arn = JSON.stringify(
        strField(node.functionArn, "REPLACE_WITH_FUNCTION_ARN"),
      );
      const payload = emitValue(
        node.payload,
        "{}",
        "payload",
        `node "${node.name}"`,
      );
      // The closure passed to dag.invoke builds the PAYLOAD (`return <payload>;`)
      // — it does not perform the invoke. Wrapping it in dagClosureBody's
      // try/catch therefore catches payload-construction errors while invoke
      // failures pass straight through, which is a false sense of recovery: the
      // same reason onError is refused on a dagContainer below.
      refuseDroppedOnError(
        node,
        "the deps closure builds the payload, not the invoke, so a try/catch " +
          "there cannot see an invoke failure",
      );
      const buildContent = (i: number) => [
        `${" ".repeat(i)}return ${payload};`,
      ];
      return [
        ...commentLines,
        head(
          `invoke(${name}, ${arn}, ${depsArr}, ${hasDeps ? "(deps) => {" : "() => {"}`,
        ),
        ...dagClosureBody(node, inner, incoming, idents, buildContent),
        close([runIf]),
      ];
    }
    case "callback": {
      const unit = unitField(node.timeoutUnit, "hours");
      const value = numField(node.timeoutValue, 24);
      const body =
        typeof node.submitterCode === "string" &&
        node.submitterCode.trim().length > 0
          ? node.submitterCode
          : "// send `callbackId` to the external system";
      const buildContent = (i: number) => [
        indent(bodyStartMarker(), i),
        indent(body, i),
        indent(bodyEndMarker(), i),
      ];
      const params = hasDeps
        ? "async (deps, callbackId, ctx) => {"
        : "async (callbackId, ctx) => {";
      return [
        ...commentLines,
        head(`callback(${name}, ${depsArr}, ${params}`),
        ...dagClosureBody(node, inner, incoming, idents, buildContent),
        close([`timeout: { ${unit}: ${value} }`, runIf]),
      ];
    }
    case "wait": {
      const runIfCfg = configSuffix([runIf]);
      const durationCode =
        typeof node.durationCode === "string" && node.durationCode.trim() !== ""
          ? node.durationCode
          : null;
      // Hoisted above the durationCode branch: the STATIC duration path returns
      // below without touching it, so a dag wait with a static duration and an
      // onError fallback dropped the fallback silently — the exact failure this
      // guard exists to stop.
      refuseDroppedOnError(node, "a wait has no closure body to wrap");
      if (durationCode) {
        // `dag.wait(name, deps, { seconds: <expr> })` evaluates the expression in
        // the SURROUNDING scope, where an upstream name is bound to its TaskHandle
        // — so `{ seconds: Up.s }` read a property off the handle and produced
        // undefined. The linear path works because there the name holds the value.
        // There is no deps closure here to inject the shim into, so refuse rather
        // than emit a wait of undefined length.
        refuseUnbindableUpstreamRefs(
          node,
          incoming,
          idents,
          durationCode,
          "wait duration",
        );
        // Same two spellings as the linear path above.
        // Per dar-specification.md, durationCode returns the wait in SECONDS. The
        // emitter wraps it as `{ seconds: <code> }`, so returning a DURATION OBJECT —
        // the natural mistake, since the SDK's own wait() takes `{ seconds: 30 }` —
        // silently produces `{ seconds: { seconds: 30 } }`, and esbuild does not
        // typecheck so it ships. Checked on the AST over top-level returns: text
        // matching cannot distinguish this from valid code that gets a duration from
        // a helper and reads a field off it.
        if (returnsDurationObject(durationCode)) {
          throw new Error(
            `Node "${node.name}": duration code must return the wait in SECONDS ` +
              `(for example "return 30;"), not a duration object — returning ` +
              `{ seconds: ... } would emit { seconds: { seconds: ... } }.`,
          );
        }
        // Both forms are interpolated verbatim, so both need checking: the expression
        // form by isExpressionText above, the block form here.
        if (!isExpressionText(durationCode)) {
          requireStatements(
            durationCode,
            "duration code",
            `node "${node.name}"`,
          );
        }
        if (isExpressionText(durationCode)) {
          return [
            ...commentLines,
            `${pad}const ${ident} = ${dagVar}.wait(${name}, ${depsArr}, { seconds: (${durationCode.trim()}) }${runIfCfg})${trailing};`,
          ];
        }
        return [
          ...commentLines,
          `${pad}const ${ident} = ${dagVar}.wait(${name}, ${depsArr}, { seconds: (() => {`,
          indent(durationCode, inner),
          `${pad}})() }${runIfCfg})${trailing};`,
        ];
      }
      const unit = unitField(node.durationUnit, "seconds");
      const value = numField(node.durationValue, 0);
      return [
        ...commentLines,
        `${pad}const ${ident} = ${dagVar}.wait(${name}, ${depsArr}, { ${unit}: ${value} }${runIfCfg})${trailing};`,
      ];
    }
    case "waitForCondition": {
      const body =
        typeof node.code === "string" && node.code.trim().length > 0
          ? node.code
          : "return { ...state };";
      const initialState = emitValue(
        node.initialState,
        "{}",
        "initialState",
        `node "${node.name}"`,
      );
      const stopExpr =
        typeof node.stopCondition === "string" &&
        node.stopCondition.trim().length > 0
          ? node.stopCondition.trim()
          : undefined;
      const waitStrategy = emitWaitStrategy(
        waitSpecOf(node),
        imports,
        stopExpr,
      );
      const buildContent = (i: number) => [
        indent(bodyStartMarker(), i),
        indent(body, i),
        indent(bodyEndMarker(), i),
      ];
      const params = hasDeps
        ? "async (deps, state, ctx) => {"
        : "async (state, ctx) => {";
      return [
        ...commentLines,
        head(`waitForCondition(${name}, ${depsArr}, ${params}`),
        ...dagClosureBody(node, inner, incoming, idents, buildContent),
        close([
          `initialState: ${initialState}`,
          `waitStrategy: ${waitStrategy}`,
          runIf,
        ]),
      ];
    }
    case "dagContainer": {
      // A nested DAG task (the corrected model's only nested-DAG mechanism):
      // `dag.dag(name, deps, (dag) => { … })` (design §6/§9). The register
      // callback takes only the sub-dag context (no deps arg, hence no shim —
      // cross-scope data crosses only via this task's own deps in and its
      // DagResult out; the inner `dag` param shadows the outer one, which is
      // correct since inner deps reference inner handles only). The body's
      // `dependencyMode` is always "dag".
      refuseDroppedOnError(
        node,
        "its callback only registers child tasks, so a try/catch there would " +
          "catch registration rather than execution errors",
      );
      const body = node.body as DarWorkflow;
      const innerIdents = buildIdentifierMap(body.nodes);
      const innerById = new Map(body.nodes.map((n) => [n.id, n]));
      const regs = emitDagRegistrations(
        body,
        { ...scope, indent: inner },
        "dag",
        innerIdents,
        innerById,
      );
      const cfgFields = dagConfigFields(
        (node.dagConfig ?? body.dagConfig) as DagConfigSpec | undefined,
        imports,
      );
      if (runIf) cfgFields.push(runIf);
      return [
        ...commentLines,
        head(`dag(${name}, ${depsArr}, (dag) => {`),
        ...regs,
        `${pad}}${configSuffix(cfgFields)})${trailing};`,
      ];
    }
    case "group": {
      // A plain child-context task: the deps shim (DAG boundary, in) is
      // injected, then the child body emits per its OWN dependencyMode — which
      // is ALWAYS "linear" for a group (the corrected model: group/map/parallel
      // bodies are always linear, so this runs the unchanged linear emitter).
      // Nested DAG is a `dagContainer`, handled above (design §4.4).
      const body = node.body as DarWorkflow;
      const buildContent = (i: number) =>
        emitBody(body, {
          ...scope,
          ctxVar: "childCtx",
          indent: i,
          imports,
        }).split("\n");
      const params = hasDeps
        ? "async (deps, childCtx) => {"
        : "async (childCtx) => {";
      return [
        ...commentLines,
        head(`runInChildContext(${name}, ${depsArr}, ${params}`),
        ...dagClosureBody(node, inner, incoming, idents, buildContent),
        close([runIf]),
      ];
    }
    case "awsJob": {
      const preset = getServiceIntegration(
        typeof node.integration === "string" ? node.integration : undefined,
      );
      if (!preset) {
        throw new Error(
          `awsJob node "${node.name}" has an unknown integration ${JSON.stringify(
            node.integration,
          )}.`,
        );
      }
      const buildContent = (i: number) =>
        awsJobInnerBody(node, preset, "childCtx", i, imports);
      const params = hasDeps
        ? "async (deps, childCtx) => {"
        : "async (childCtx) => {";
      return [
        ...commentLines,
        head(`runInChildContext(${name}, ${depsArr}, ${params}`),
        ...dagClosureBody(node, inner, incoming, idents, buildContent),
        close([runIf]),
      ];
    }
    case "map": {
      const itemsCode =
        typeof node.itemsCode === "string" && node.itemsCode.trim().length > 0
          ? node.itemsCode
          : "return [];";
      let nesting = "";
      if (node.nesting === "FLAT") {
        imports.add("NestingType");
        nesting = "nesting: NestingType.FLAT";
      }
      const config = [
        Number.isFinite(node.maxConcurrency)
          ? `maxConcurrency: ${node.maxConcurrency}`
          : "",
        emitCompletionConfig(node),
        nesting,
        runIf,
      ];
      refuseDroppedOnError(
        node,
        "only a group task's closure is wrapped in the try/catch",
      );
      const child = emitBody(node.body as DarWorkflow, {
        ...scope,
        ctxVar: "ctx",
        indent: inner,
        imports,
      });
      // The ITERATEE gets no deps parameter — only the items closure below does —
      // so an upstream reference in the body would resolve to the handle.
      refuseUnbindableUpstreamRefs(
        node,
        incoming,
        idents,
        child,
        "map iteratee",
      );
      // items is `TIn[] | ((deps) => TIn[])`; emit the deps-fn form so upstream
      // results can shape the items (shim injected), guarding nullish like linear.
      const itemsShim = dagShimLines(incoming, idents, inner);
      const lines = [...commentLines];
      if (hasDeps) {
        lines.push(
          head(`map(${name}, ${depsArr}, (deps) => {`),
          ...itemsShim,
          `${" ".repeat(inner)}return ((): unknown[] => {`,
          indent(itemsCode, inner + 2),
          `${" ".repeat(inner)}})() ?? [];`,
          `${pad}}, async (ctx, item, index) => {`,
          child,
          close(config),
        );
      } else {
        lines.push(
          head(`map(${name}, ${depsArr}, ((): unknown[] => {`),
          indent(itemsCode, inner),
          `${pad}})() ?? [], async (ctx, item, index) => {`,
          child,
          close(config),
        );
      }
      return lines;
    }
    case "parallel": {
      const branches = Array.isArray(node.branches)
        ? (node.branches as { name: string; body: DarWorkflow }[])
        : [];
      refuseDroppedOnError(
        node,
        "only a group task's closure is wrapped in the try/catch",
      );
      const branchPad = " ".repeat(inner);
      const branchLines = branches.map((b) => {
        const body = emitBody(b.body, {
          ...scope,
          ctxVar: "ctx",
          indent: inner + 2,
          imports,
        });
        // A branch func is `async (ctx) => …` with no deps parameter, so an
        // upstream reference here would be the handle, not the value.
        refuseUnbindableUpstreamRefs(
          node,
          incoming,
          idents,
          body,
          "parallel branch",
        );
        return [
          `${branchPad}{`,
          `${branchPad}  name: ${JSON.stringify(b.name)},`,
          `${branchPad}  func: async (ctx) => {`,
          body,
          `${branchPad}  },`,
          `${branchPad}},`,
        ].join("\n");
      });
      const config = [
        Number.isFinite(node.maxConcurrency)
          ? `maxConcurrency: ${node.maxConcurrency}`
          : "",
        emitCompletionConfig(node),
        runIf,
      ];
      return [
        ...commentLines,
        head(`parallel(${name}, ${depsArr}, [`),
        ...branchLines,
        `${pad}]${configSuffix(config)})${trailing};`,
      ];
    }
    default:
      throw new Error(
        `DAG codegen for node kind "${node.kind}" is not implemented.`,
      );
  }
}

/**
 * Emits the return of a dag scope's aggregate result. A DAG has no `end` node —
 * it completes by draining / its completion policy and yields its aggregate
 * {@link DagResult} (bound to {@link DAG_RESULT_IDENT}). So this ALWAYS returns
 * that result const; there is no end-node return in a DAG.
 */
function emitDagEnd(scope: Scope): string {
  const pad = " ".repeat(scope.indent);
  return `${pad}return ${DAG_RESULT_IDENT};`;
}

/**
 * The inner body of an `awsJob` task in DAG mode (the poll loop): the `start`
 * step, the `waitForCondition` poll with a bounded attempt cap, and the
 * success/failure checks, all against `ctxVar` (a `childCtx`), at
 * `indentSpaces`. Records the SDK client + command imports. Mirrors the linear
 * {@link emitNode}'s `awsJob` body (kept separate so the linear emitter's
 * byte-for-byte output stays untouched); the two are structurally identical.
 */
function awsJobInnerBody(
  node: DarNode,
  preset: NonNullable<ReturnType<typeof getServiceIntegration>>,
  ctxVar: string,
  indentSpaces: number,
  imports: Set<string>,
): string[] {
  imports.add(
    `@sdk|${preset.clientPackage}|${preset.clientClass}|${preset.start.command}|${preset.poll.command}`,
  );
  const startInput = emitValue(
    node.startInput,
    "{}",
    "startInput",
    `node "${node.name}"`,
  );
  const pollSeconds =
    typeof node.pollIntervalSeconds === "number" &&
    Number.isFinite(node.pollIntervalSeconds) &&
    node.pollIntervalSeconds > 0
      ? node.pollIntervalSeconds
      : preset.defaultPollSeconds;
  const clientNew =
    typeof node.region === "string" && node.region.trim().length > 0
      ? `new ${preset.clientClass}({ region: ${JSON.stringify(node.region.trim())} })`
      : `new ${preset.clientClass}({})`;
  const success = JSON.stringify(preset.success);
  const failure = JSON.stringify(preset.failure);
  const maxAttempts = Math.max(
    1,
    Math.ceil(preset.maxWaitSeconds / pollSeconds),
  );
  const resultExpr = preset.poll.resultPath
    ? `(final.result as Record<string, any>)?.${preset.poll.resultPath}`
    : "final.result";
  const p = " ".repeat(indentSpaces);
  const p2 = " ".repeat(indentSpaces + 2);
  const p3 = " ".repeat(indentSpaces + 4);
  return [
    `${p}const startInput = ${startInput} as Record<string, any>;`,
    `${p}const started = (await ${ctxVar}.step(${JSON.stringify(
      node.name + "-start",
    )}, async () => {`,
    `${p2}const client = ${clientNew};`,
    `${p2}return await client.send(new ${preset.start.command}(startInput as never));`,
    `${p}})) as Record<string, any>;`,
    `${p}const jobId = started.${preset.start.idPath};`,
    `${p}const final = (await ${ctxVar}.waitForCondition(`,
    `${p2}${JSON.stringify(node.name + "-wait")},`,
    `${p2}async (state) => {`,
    `${p3}const client = ${clientNew};`,
    `${p3}const res = (await client.send(new ${preset.poll.command}(${preset.poll.inputExpr} as never))) as Record<string, any>;`,
    `${p3}return { ...state, status: res.${preset.poll.statusPath}, result: res };`,
    `${p2}},`,
    `${p2}{`,
    `${p3}initialState: { status: ${JSON.stringify(
      preset.initialStatus,
    )}, result: null as unknown },`,
    `${p3}waitStrategy: (state: { status?: string }, attempt: number) => ({`,
    `${p3}  shouldContinue:`,
    `${p3}    attempt < ${maxAttempts} &&`,
    `${p3}    !${success}.includes(state.status as string) &&`,
    `${p3}    !${failure}.includes(state.status as string),`,
    `${p3}  delay: { seconds: ${pollSeconds} },`,
    `${p3}}),`,
    `${p2}},`,
    `${p})) as { status?: string; result: unknown };`,
    `${p}if (${failure}.includes(final.status as string)) {`,
    `${p2}throw new Error(${JSON.stringify(node.name + " failed: ")} + final.status);`,
    `${p}}`,
    `${p}if (!${success}.includes(final.status as string)) {`,
    `${p2}throw new Error(`,
    `${p3}${JSON.stringify(
      node.name + " did not complete within ~" + preset.maxWaitSeconds + "s: ",
    )} + final.status,`,
    `${p2});`,
    `${p}}`,
    `${p}return ${resultExpr};`,
  ];
}

/**
 * Generates a deterministic `withDurableExecution` handler from a `.dar`
 * workflow. Each operation node's result is bound to a `const` named after the
 * node (e.g. `const stepA = await context.step("stepA", …)`), so a later node's
 * code can reference earlier results by that name. Container bodies
 * (map/group/parallel) are emitted recursively. Same `.dar` ⇒ byte-identical
 * handler (clean diffs + replay determinism).
 */
/** Options for {@link generateHandler}. */
export interface GenerateHandlerOptions {
  /**
   * Permit `dag` dependency mode. Off by default because the generated code
   * calls a runtime that does not exist yet — see {@link dagModeAllowed}.
   */
  allowDagMode?: boolean;
}

export function generateHandler(
  wf: DarWorkflow,
  opts?: GenerateHandlerOptions,
): string {
  return stripNodeMarkers(generateHandlerMarked(wf, opts));
}

// Re-exported (not renamed) so `sourceMap.ts`'s `generateHandlerWithMap` can
// build a map from the marker-carrying output without duplicating codegen.
// Kept out of the package's public `index.ts` — only `sourceMap.ts` imports
// it directly by relative path.
export { generateHandlerMarked };

/**
 * Same output as {@link generateHandler}, but every node's first emitted line
 * is preceded by an invisible {@link nodeMarker} sentinel comment (still valid,
 * harmless TypeScript) identifying which `.dar` node produced the code below
 * it. Used only by {@link generateHandlerWithMap} to locate node boundaries in
 * the generated text before markers are stripped for the final handler string.
 * Not exported — every other caller wants {@link generateHandler}'s clean
 * output.
 */
function generateHandlerMarked(
  wf: DarWorkflow,
  opts?: GenerateHandlerOptions,
): string {
  const imports = new Set<string>();
  // Seeded into the root scope, which every emitter frame already receives.
  const body = emitBody(wf, { ctxVar: "context", indent: 4, imports, opts });
  // Separate AWS SDK v3 client imports (sentinel `@sdk|pkg|client|start|poll`,
  // emitted by awsJob nodes) from the durable-SDK named imports.
  const all = [...imports];
  const sdkSentinels = all.filter((n) => n.startsWith("@sdk|"));
  const extra = all.filter((n) => !n.startsWith("@sdk|")).sort();
  // Merge SDK client + command names per package (a workflow may have several
  // jobs on the same service).
  const namesByPackage = new Map<string, Set<string>>();
  for (const s of sdkSentinels) {
    const [, pkg, client, ...cmds] = s.split("|");
    if (!namesByPackage.has(pkg)) namesByPackage.set(pkg, new Set());
    const set = namesByPackage.get(pkg) as Set<string>;
    set.add(client);
    for (const c of cmds) if (c) set.add(c);
  }
  const sdkImportLines = [...namesByPackage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([pkg, names]) =>
        `import { ${[...names].sort().join(", ")} } from ${JSON.stringify(pkg)};`,
    );
  const importLines = [
    `import {`,
    `  withDurableExecution,`,
    `  DurableContext,`,
    ...extra.map((n) => `  ${n},`),
    `} from "@aws/durable-execution-sdk-js";`,
    ...sdkImportLines,
  ];
  const inputType =
    typeof wf.inputType === "string" && wf.inputType.trim().length > 0
      ? wf.inputType.trim()
      : "unknown";
  return fixLambdaPayloadDecoding(
    [
      `// Generated from ${JSON.stringify(wf.name)} by @aws/durable-execution-sdk-js-cdk.`,
      `// Do not edit — regenerate from the .dar workflow instead.`,
      ``,
      ...importLines,
      ``,
      `type WorkflowInput = ${requireTypeExpression(
        inputType,
        "workflow input type",
        "Workflow",
      )};`,
      ``,
      `export const handler = withDurableExecution(`,
      `  async (event: WorkflowInput, context: DurableContext) => {`,
      `    const input = event;`,
      body,
      `  },`,
      `);`,
      ``,
    ].join("\n"),
  );
}
