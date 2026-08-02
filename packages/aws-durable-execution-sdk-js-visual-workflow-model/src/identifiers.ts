import type { DarNodeKind } from "./kinds";

/**
 * Identifiers a generated result const must not use: runtime-injected symbols
 * (the handler's `event`/`input`, context vars, callback/wait params, `err`,
 * map `item`/`index`) and JS reserved words / literals that break as a `const`
 * name. Shared so the Studio and the CDK generator agree exactly.
 */
export const RESERVED_IDENTIFIERS = new Set<string>([
  // runtime-injected
  "event",
  "input",
  "context",
  "stepCtx",
  "ctx",
  "childCtx",
  "callbackId",
  "state",
  "err",
  "item",
  "index",
  "handler",
  // dag-mode injected bindings. `dag` is the scope builder and `deps` the
  // upstream-results shim, both emitted around the user's nodes; `result` is the
  // DagResult bound at the end of a dag scope. A node named after any of these
  // shadows the binding on the very line that defines it, which is a TDZ
  // ReferenceError at runtime rather than a compile error — so reserve them and
  // let buildIdentifierMap raise the clear rename error instead.
  "dag",
  "deps",
  "result",
  // Bindings the EMITTERS inject around a node's own content. In dag mode the deps
  // shim and the task body land in the SAME block, so an upstream node named `url`
  // feeding an httpCall emits `const url = deps["url"]; const url = new URL(...)` —
  // a hard syntax error. In linear mode it degrades to a TDZ ReferenceError: an
  // awsJob whose startInput references an upstream node named `started` resolves to
  // the not-yet-initialized local. Same reasoning as dag/deps/result above.
  "url",
  "query",
  "headers",
  "payload",
  "response",
  "text",
  "startInput",
  "started",
  "jobId",
  "final",
  "client",
  "res",
  // Reserved ONLY under strict mode — and the generated handler is an ES module,
  // which is always strict. `const public = 1` is a SyntaxError there, so without
  // these a node named `public` passed buildIdentifierMap and then failed at bundle
  // time with an opaque esbuild error instead of the clear rename message.
  "public",
  "private",
  "protected",
  "static",
  "interface",
  "implements",
  "package",
  "arguments",
  "eval",
  // JS reserved words / literals
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/** Turns a node name into a safe JavaScript identifier (not necessarily unique). */
export function toIdentifier(name: string): string {
  let id = (name ?? "").replace(/[^A-Za-z0-9_$]/g, "_");
  if (id === "") id = "node";
  if (/^[0-9]/.test(id)) id = `_${id}`;
  return id;
}

/** Minimal node shape needed to build the identifier map. */
export interface IdentifiableNode {
  id: string;
  kind: DarNodeKind;
  name: string;
}

/**
 * Maps each operation node (start/end excluded) to its result identifier,
 * `toIdentifier(name)` — 1:1, so the generated `const` matches the "Edit in VS
 * Code" scaffold's `declare const` exactly. Throws a clear error if two nodes
 * collide on an identifier or an identifier is reserved, rather than silently
 * renaming (which would desync code that references the un-suffixed name).
 */
export function buildIdentifierMap(
  nodes: readonly IdentifiableNode[],
): Map<string, string> {
  const used = new Map<string, string>(); // identifier -> node name
  const map = new Map<string, string>(); // node id -> identifier
  for (const n of nodes) {
    if (n.kind === "start" || n.kind === "end") continue;
    const id = toIdentifier(n.name);
    if (RESERVED_IDENTIFIERS.has(id)) {
      throw new Error(
        `Node "${n.name}" maps to the reserved identifier "${id}" — rename it.`,
      );
    }
    const clash = used.get(id);
    if (clash !== undefined) {
      throw new Error(
        `Nodes "${clash}" and "${n.name}" both map to the identifier "${id}" — names must be unique after sanitizing.`,
      );
    }
    used.set(id, n.name);
    map.set(n.id, id);
  }
  return map;
}
