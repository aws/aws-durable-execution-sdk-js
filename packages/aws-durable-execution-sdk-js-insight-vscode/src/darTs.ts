/**
 * `.dar.ts` — the TypeScript projection of a workflow (see
 * docs/dar-ts-specification.md). This module converts between the JSON model
 * (the in-memory/wire shape) and the `.dar.ts` authoring format:
 *
 *   - {@link workflowToDarTs}: model → canonical `.dar.ts` text. Code blocks
 *     become named functions whose parameter lists encode their scope; child
 *     workflows become flat top-level consts (deepest-first); everything
 *     ABOUT the workflow (canvas layout, deployment record) is quarantined
 *     in a trailing `meta` object.
 *   - {@link parseDarTs}: `.dar.ts` text → model, by **static analysis only**
 *     (TypeScript compiler API). The file is never executed; only a
 *     restricted literal subset is accepted, with clear errors otherwise.
 *
 * vscode-free so the VS Code extension and the desktop app share it.
 */
import * as ts from "typescript";
import { toIdentifier } from "@aws/durable-execution-sdk-js-visual-workflow-model";

/** Loose views of the JSON model (matches what the webview saves). */
type JsonNode = Record<string, unknown> & {
  id: string;
  kind: string;
  name: string;
};
type JsonEdge = Record<string, unknown> & {
  id: string;
  source: string;
  target: string;
};
export interface JsonWorkflow {
  [key: string]: unknown;
  darVersion?: string;
  name?: string;
  dependencyMode?: string;
  inputType?: string;
  layoutDirection?: string;
  /**
   * Deployment record, persisted in the file's trailing `meta.deploy` block
   * once the workflow has been deployed — lets a freshly reopened `.dar.ts`
   * reconnect to its Lambda (Debug button, deploy-name prefill) across
   * VS Code restarts. Only identity, never machine-specific paths: the
   * debug-artifact folder is derived from `functionName` at use time.
   */
  deploy?: { functionName: string; region: string; deployedAt?: string };
  nodes: JsonNode[];
  edges?: JsonEdge[];
}

/** Code-bearing fields that become functions, per node kind (v1). */
const FUNCTION_FIELDS: Record<string, string[]> = {
  step: ["code"],
  inline: ["code"],
  condition: ["code"],
  waitForCondition: ["code"],
  callback: ["submitterCode"],
  end: ["code"],
};

const OP_KINDS_EXCLUDED = new Set(["start", "end"]);

/** Strips a common indent and blank edges from a code block. */
function dedent(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  const indents = lines
    .filter((l) => l.trim() !== "")
    .map((l) => (l.match(/^ */) as RegExpMatchArray)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n");
}

/** Indents every non-empty line by `spaces`. */
function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((l) => (l.length > 0 ? pad + l : l))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/** One workflow scope discovered while walking containers (deepest-first). */
interface WfScope {
  wf: JsonWorkflow;
  /** Const name for children; "workflow" for the root. */
  constName: string;
  /** Extra scope symbols nodes inside this workflow can reference. */
  extras: { name: string; type: string }[];
}

/** Result identifiers of all ancestors of `nodeId` (through every edge). */
function upstreamNames(wf: JsonWorkflow, nodeId: string): string[] {
  const preds = new Map<string, string[]>();
  for (const e of wf.edges ?? []) {
    const list = preds.get(e.target);
    if (list) list.push(e.source);
    else preds.set(e.target, [e.source]);
  }
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = [...(preds.get(nodeId) ?? [])];
  const names = new Map<string, JsonNode>();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (n && !OP_KINDS_EXCLUDED.has(n.kind)) names.set(toIdentifier(n.name), n);
    for (const p of preds.get(id) ?? []) stack.push(p);
  }
  return [...names.keys()].sort();
}

/** Builds the parameter list encoding a node's scope (spec §3.3). */
function paramsFor(
  scope: WfScope,
  node: JsonNode,
  field: string,
  resultTypes: Map<string, string>,
): string {
  const params: string[] = [];
  if (node.kind === "waitForCondition" && field === "code")
    params.push("state: any");
  if (node.kind === "callback" && field === "submitterCode")
    params.push("callbackId: string");
  const isErrorTarget = (scope.wf.edges ?? []).some(
    (e) => e.kind === "error" && e.target === node.id,
  );
  if (isErrorTarget) params.push("err: unknown");
  // Types are parenthesized: a crafted "type" cannot terminate the parameter
  // list — it becomes a syntax error instead of injected code.
  for (const x of scope.extras) params.push(`${x.name}: (${x.type})`);
  for (const up of upstreamNames(scope.wf, node.id)) {
    params.push(`${up}: (${resultTypes.get(up) ?? "any"})`);
  }
  return params.join(", ");
}

/** Serializes a JSON model workflow as canonical `.dar.ts` text. */
export function workflowToDarTs(root: JsonWorkflow): string {
  // Collect all workflow scopes, deepest-first, and assign const names.
  const scopes: WfScope[] = [];
  const usedConsts = new Set<string>(["workflow", "meta"]);
  const uniqueConst = (base: string): string => {
    let name = base;
    let i = 2;
    while (usedConsts.has(name)) name = `${base}${i++}`;
    usedConsts.add(name);
    return name;
  };
  const visit = (
    wf: JsonWorkflow,
    constName: string,
    extras: WfScope["extras"],
  ) => {
    for (const n of wf.nodes) {
      const body = n.body as JsonWorkflow | undefined;
      if (
        (n.kind === "map" || n.kind === "group" || n.kind === "dagContainer") &&
        body
      ) {
        visit(
          body,
          uniqueConst(`${toIdentifier(n.name)}Body`),
          n.kind === "map"
            ? [
                { name: "item", type: "any" },
                { name: "index", type: "number" },
              ]
            : [],
        );
      }
      if (n.kind === "parallel") {
        const branches =
          (n.branches as { name: string; body: JsonWorkflow }[] | undefined) ??
          [];
        for (const b of branches) {
          visit(
            b.body,
            uniqueConst(`${toIdentifier(`${n.name}-${b.name}`)}Body`),
            [],
          );
        }
      }
    }
    scopes.push({ wf, constName, extras });
  };
  const inputType = (root.inputType ?? "").trim() || "any";
  visit(root, "workflow", [
    { name: "event", type: inputType },
    { name: "input", type: inputType },
  ]);

  // Result types by identifier (for scope-parameter typing), file-wide.
  const resultTypes = new Map<string, string>();
  for (const s of scopes) {
    for (const n of s.wf.nodes) {
      const rt = typeof n.resultType === "string" ? n.resultType.trim() : "";
      if (rt && !OP_KINDS_EXCLUDED.has(n.kind))
        resultTypes.set(toIdentifier(n.name), rt);
    }
  }

  // Assign a unique function name per (node, field).
  const usedFns = new Set<string>(usedConsts);
  const fnNames = new Map<string, string>(); // `${nodeId}\u0000${field}` -> name
  const uniqueFn = (base: string): string => {
    let name = base;
    let i = 2;
    while (usedFns.has(name)) name = `${base}${i++}`;
    usedFns.add(name);
    return name;
  };

  const functionDecls: string[] = [];
  const constDecls: string[] = [];
  const positions: string[] = [];

  for (const scope of scopes) {
    for (const node of scope.wf.nodes) {
      const pos = node.position as { x?: number; y?: number } | undefined;
      if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
        positions.push(
          `    ${JSON.stringify(node.id)}: [${Math.round(pos.x)}, ${Math.round(pos.y)}],`,
        );
      }
      for (const field of FUNCTION_FIELDS[node.kind] ?? []) {
        const code = node[field];
        if (typeof code !== "string" || code.trim() === "") continue;
        const name = uniqueFn(toIdentifier(node.name));
        fnNames.set(`${node.id}\u0000${field}`, name);
        const isAsync =
          node.kind !== "condition" &&
          node.kind !== "inline" &&
          node.kind !== "end";
        const params = paramsFor(scope, node, field, resultTypes);
        functionDecls.push(
          `${isAsync ? "async " : ""}function ${name}(${params}) {\n${indent(dedent(code), 2)}\n}`,
        );
      }
    }
    constDecls.push(emitWorkflowConst(scope, fnNames, scopes));
  }

  // The trailing `meta` object quarantines everything that is ABOUT the
  // workflow rather than part of it: canvas layout, and (when the workflow
  // has been deployed) the deployment record that lets a reopened file
  // reconnect to its Lambda for debugging without redeploying. It stays at
  // the very BOTTOM of the file on purpose — growing or shrinking it never
  // shifts the function-body line numbers above it, so source maps and
  // breakpoints recorded against an earlier save stay valid.
  const deploy = root.deploy;
  const deployLines = deploy
    ? [
        "  deploy: {",
        `    functionName: ${JSON.stringify(deploy.functionName)},`,
        `    region: ${JSON.stringify(deploy.region)},`,
        ...(deploy.deployedAt
          ? [`    deployedAt: ${JSON.stringify(deploy.deployedAt)},`]
          : []),
        "  },",
      ]
    : [];
  const metaLines = [
    "export const meta = {",
    "  layout: {",
    `    direction: ${JSON.stringify(root.layoutDirection === "LR" ? "LR" : "TB")},`,
    "    positions: {",
    ...positions.map((l) => `  ${l}`),
    "    },",
    "  },",
    ...deployLines,
    "};",
  ].join("\n");

  // No import, no type annotations: a .dar.ts must be self-contained (an
  // unresolvable package import would error in any editor outside a project
  // that depends on it). The parser identifies parts by name/shape.
  return [...functionDecls, ...constDecls, metaLines, ""].join("\n\n");
}

/** Fields never serialized into the definition literal. */
const OMIT_FIELDS = new Set(["position"]);
/** Stable leading field order for node literals. */
const NODE_FIELD_ORDER = ["id", "kind", "name"];

/** Emits `const <name>: WorkflowDefinition = {…};` for one workflow scope. */
function emitWorkflowConst(
  scope: WfScope,
  fnNames: Map<string, string>,
  scopes: WfScope[],
): string {
  const { wf, constName } = scope;
  const constFor = (child: unknown): string => {
    const s = scopes.find((x) => x.wf === child);
    if (!s) throw new Error("internal: unregistered child workflow");
    return s.constName;
  };
  const REF = "\u0000REF:"; // placeholder marker, replaced after stringify
  // Strip NUL from user-controlled strings so nothing can spoof the marker.
  const stripNul = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(/\u0000/g, "");
    if (Array.isArray(v)) return v.map(stripNul);
    if (typeof v === "object" && v !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = stripNul(x);
      return out;
    }
    return v;
  };

  const nodeOut = (n: JsonNode): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const keys = [
      ...NODE_FIELD_ORDER,
      ...Object.keys(n).filter((k) => !NODE_FIELD_ORDER.includes(k)),
    ];
    for (const k of keys) {
      if (OMIT_FIELDS.has(k) || n[k] === undefined || !(k in n)) continue;
      const fn = fnNames.get(`${n.id}\u0000${k}`);
      if (fn) {
        out[k] = `${REF}${fn}`;
      } else if (k === "body") {
        out[k] = `${REF}${constFor(n[k])}`;
      } else if (k === "branches" && n.kind === "parallel") {
        // Preserve every per-branch field, replacing only `body` with its const
        // reference. The previous id/name/body allowlist silently dropped anything
        // else on the next save — which contradicts the forward-compatibility the
        // workflow-level loop above deliberately implements, and made a round-trip
        // through Studio lossy for any branch field this version does not know.
        out[k] = (n[k] as Record<string, unknown>[]).map((b) => {
          const branch: Record<string, unknown> = {};
          for (const bk of Object.keys(b)) {
            branch[bk] =
              bk === "body" ? `${REF}${constFor(b[bk])}` : stripNul(b[bk]);
          }
          return branch;
        });
      } else {
        out[k] = stripNul(n[k]);
      }
    }
    return out;
  };

  // Every workflow-level field is preserved, not just a known allowlist. An
  // allowlist silently dropped `dagConfig` — which drives defaultTriggerRule /
  // nesting / concurrency in the emitted `context.dag(...)` — so saving and
  // redeploying changed execution semantics. It also broke the forward
  // compatibility `dar-specification.md` promises, since a field written by a
  // NEWER Studio would be discarded by an older one on the next save.
  //
  // `layoutDirection` and `deploy` are the deliberate exceptions: they are about
  // the workflow rather than part of it and live in the trailing `meta` object
  // (see the `metaLines` comment). `nodes`/`edges` are emitted below after their
  // own per-node reference rewriting.
  const WF_META_FIELDS = new Set([
    "layoutDirection",
    "deploy",
    "nodes",
    "edges",
  ]);
  /** Stable leading order so diffs stay readable across saves. */
  const WF_FIELD_ORDER = [
    "darVersion",
    "name",
    "comment",
    "dependencyMode",
    "inputType",
  ];
  const def: Record<string, unknown> = {
    darVersion: wf.darVersion ?? "1.0",
    name: stripNul(wf.name ?? "Untitled workflow"),
    ...(typeof wf.comment === "string" && wf.comment !== ""
      ? { comment: stripNul(wf.comment) }
      : {}),
    ...(wf.dependencyMode !== undefined
      ? { dependencyMode: wf.dependencyMode }
      : {}),
    ...(wf.inputType !== undefined
      ? { inputType: stripNul(wf.inputType) }
      : {}),
  };
  const wfRec = wf as unknown as Record<string, unknown>;
  for (const key of Object.keys(wfRec)) {
    if (WF_META_FIELDS.has(key) || WF_FIELD_ORDER.includes(key)) continue;
    if (wfRec[key] === undefined) continue;
    def[key] = stripNul(wfRec[key]);
  }
  def.nodes = wf.nodes.map(nodeOut);
  def.edges = stripNul(wf.edges ?? []);

  // Stringify, then unquote reference placeholders into bare identifiers.
  // (JSON.stringify writes \u0000 as the six-char escape, so match that.)
  const json = JSON.stringify(def, null, 2).replace(
    /"\\u0000REF:([A-Za-z0-9_$]+)"/g,
    "$1",
  );
  const exportKw = constName === "workflow" ? "export " : "";
  return `${exportKw}const ${constName} = ${json};`;
}

// ---------------------------------------------------------------------------
// Parser (static analysis only — the file is NEVER executed)
// ---------------------------------------------------------------------------

class DarTsError extends Error {}

function fail(sf: ts.SourceFile, node: ts.Node, message: string): never {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  throw new DarTsError(`Not a valid .dar.ts (line ${line + 1}): ${message}`);
}

/** Parses `.dar.ts` source into a JSON-model workflow object. */
export function parseDarTs(source: string): JsonWorkflow {
  const sf = ts.createSourceFile(
    "workflow.dar.ts",
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
  );

  const functions = new Map<string, string>(); // name -> body text
  const defs = new Map<string, ts.ObjectLiteralExpression>();
  let metaLit: ts.ObjectLiteralExpression | null = null;
  let rootName: string | null = null;

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) continue; // regenerated on save
    if (ts.isFunctionDeclaration(stmt)) {
      if (!stmt.name || !stmt.body)
        fail(sf, stmt, "code functions must be named and have a body");
      const body = stmt.body;
      functions.set(
        stmt.name.text,
        dedent(source.slice(body.getStart(sf) + 1, body.getEnd() - 1)),
      );
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      const decls = stmt.declarationList.declarations;
      if (decls.length !== 1)
        fail(sf, stmt, "one declaration per const statement");
      const d = decls[0];
      if (!ts.isIdentifier(d.name) || !d.initializer)
        fail(sf, stmt, "consts must be `const <name> = { … }`");
      if (!ts.isObjectLiteralExpression(d.initializer))
        fail(sf, stmt, `const ${d.name.text} must be an object literal`);
      const isExported = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      const typeName =
        d.type &&
        ts.isTypeReferenceNode(d.type) &&
        ts.isIdentifier(d.type.typeName)
          ? d.type.typeName.text
          : undefined;
      if (d.name.text === "meta" || typeName === "WorkflowMeta") {
        metaLit = d.initializer;
      } else {
        defs.set(d.name.text, d.initializer);
        if (isExported) {
          if (rootName !== null)
            fail(sf, stmt, "only one exported workflow definition is allowed");
          rootName = d.name.text;
        }
      }
      continue;
    }
    fail(
      sf,
      stmt,
      "only the type import, code functions, workflow consts and the meta object are allowed at the top level",
    );
  }

  if (rootName === null)
    throw new DarTsError(
      "Not a valid .dar.ts: no exported workflow definition found.",
    );

  // Evaluate the restricted literal subset. `code`/`submitterCode` identifiers
  // resolve to function body text; `body` identifiers resolve to (already
  // parsed) child definitions — cycles rejected via the resolution stack.
  const resolved = new Map<string, JsonWorkflow>();
  const resolving = new Set<string>();

  const evalExpr = (expr: ts.Expression, prop: string): unknown => {
    if (ts.isObjectLiteralExpression(expr)) {
      const out: Record<string, unknown> = {};
      for (const p of expr.properties) {
        if (!ts.isPropertyAssignment(p))
          fail(sf, p, "only plain `key: value` properties are allowed");
        const key = ts.isIdentifier(p.name)
          ? p.name.text
          : ts.isStringLiteral(p.name)
            ? p.name.text
            : fail(sf, p, "computed property names are not allowed");
        out[key] = evalExpr(p.initializer, key);
      }
      return out;
    }
    if (ts.isArrayLiteralExpression(expr))
      return expr.elements.map((e) => evalExpr(e, prop));
    if (ts.isStringLiteralLike(expr)) return expr.text;
    if (ts.isNumericLiteral(expr)) return Number(expr.text);
    if (
      ts.isPrefixUnaryExpression(expr) &&
      expr.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expr.operand)
    )
      return -Number(expr.operand.text);
    if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (expr.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(expr)) {
      if (prop === "code" || prop === "submitterCode") {
        const body = functions.get(expr.text);
        if (body === undefined)
          fail(sf, expr, `unknown code function "${expr.text}"`);
        return body;
      }
      if (prop === "body") {
        return resolveDef(expr.text, expr);
      }
      fail(sf, expr, `identifier references are only allowed for code/body`);
    }
    return fail(
      sf,
      expr,
      `unsupported expression (${ts.SyntaxKind[expr.kind]}) — only literals and code/body references are allowed`,
    );
  };

  const resolveDef = (name: string, at: ts.Node): JsonWorkflow => {
    const cached = resolved.get(name);
    if (cached) return cached;
    if (resolving.has(name))
      fail(sf, at, `circular workflow reference through "${name}"`);
    const lit = defs.get(name);
    if (!lit) fail(sf, at, `unknown workflow definition "${name}"`);
    resolving.add(name);
    const value = evalExpr(lit, "") as JsonWorkflow;
    resolving.delete(name);
    if (!Array.isArray(value.nodes))
      fail(sf, lit, `workflow "${name}" is missing a \`nodes\` array`);
    resolved.set(name, value);
    return value;
  };

  const root = resolveDef(rootName, sf);

  // Sharing (two containers referencing one definition) is reserved for a
  // future feature — reject so edits can't silently affect two call sites.
  {
    const seen = new Set<JsonWorkflow>();
    const walkBodies = (wf: JsonWorkflow, at: ts.Node) => {
      for (const n of wf.nodes ?? []) {
        const bodies: JsonWorkflow[] = [];
        if (n.body) bodies.push(n.body as JsonWorkflow);
        for (const b of (n.branches as { body?: JsonWorkflow }[]) ?? [])
          if (b.body) bodies.push(b.body);
        for (const b of bodies) {
          if (seen.has(b))
            fail(sf, at, "a child workflow definition is referenced twice");
          seen.add(b);
          walkBodies(b, at);
        }
      }
    };
    walkBodies(root, sf);
  }

  // Apply the meta object: layout positions back onto nodes, direction onto
  // the root, and the deployment record (if the file was ever deployed) onto
  // root.deploy — see JsonWorkflow.deploy's doc comment for what it enables.
  const positions = new Map<string, { x: number; y: number }>();
  let direction: string | undefined;
  if (metaLit) {
    const meta = evalExpr(metaLit, "") as {
      layout?: { direction?: string; positions?: Record<string, unknown> };
      deploy?: {
        functionName?: unknown;
        region?: unknown;
        deployedAt?: unknown;
      };
    };
    const layout = meta.layout ?? {};
    if (layout.direction === "TB" || layout.direction === "LR")
      direction = layout.direction;
    for (const [id, v] of Object.entries(layout.positions ?? {})) {
      if (
        Array.isArray(v) &&
        typeof v[0] === "number" &&
        typeof v[1] === "number"
      )
        positions.set(id, { x: v[0], y: v[1] });
    }
    if (
      meta.deploy &&
      typeof meta.deploy.functionName === "string" &&
      typeof meta.deploy.region === "string"
    ) {
      root.deploy = {
        functionName: meta.deploy.functionName,
        region: meta.deploy.region,
        ...(typeof meta.deploy.deployedAt === "string"
          ? { deployedAt: meta.deploy.deployedAt }
          : {}),
      };
    }
  }
  const applyPositions = (wf: JsonWorkflow) => {
    for (const n of wf.nodes ?? []) {
      const p = positions.get(n.id);
      if (p) n.position = p;
      if (n.body) applyPositions(n.body as JsonWorkflow);
      for (const b of (n.branches as { body?: JsonWorkflow }[]) ?? [])
        if (b.body) applyPositions(b.body);
    }
  };
  applyPositions(root);
  if (direction) root.layoutDirection = direction;
  return root;
}

/** True when a filename should be treated as the TypeScript workflow format. */
export function isDarTsFile(path: string): boolean {
  return /\.dar\.ts$/i.test(path);
}

/**
 * Loads any workflow file's content as JSON model text, sniffing the content
 * rather than trusting the extension (users rename files): a `{` start is the
 * legacy JSON `.dar`; anything else is parsed as `.dar.ts`.
 */
export function workflowFileToJsonText(content: string): string {
  if (content.trimStart().startsWith("{")) return content;
  return JSON.stringify(parseDarTs(content));
}
