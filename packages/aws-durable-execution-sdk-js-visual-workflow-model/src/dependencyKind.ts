/**
 * Single source of truth for deciding an edge's {@link DarEdgeDependencyKind}
 * — **result** (the source task's value is passed into the target's `deps`
 * map, and codegen injects `const <src> = deps["<src>"]`) vs. **ordering** (a
 * wait-only `.after()` dependency that injects no result).
 *
 * The kind is **auto-inferred** from whether the target task's code actually
 * references the source (design §5, updated 2026-07-30): if it does, the edge
 * is a result dependency; otherwise it is ordering-only. The stored
 * `edge.dependencyKind` is an optional **explicit override** honored verbatim
 * when present. Both the CDK code generator and the Studio canvas call this so
 * the two can never drift — the emitted `.after()`/deps-array shape and the
 * canvas's dotted "after" styling always agree.
 */
import { toIdentifier } from "./identifiers";
import type { DarEdgeDependencyKind } from "./kinds";

/**
 * Code-bearing string fields a task node may reference a dependency from. A
 * node shape is loosely typed across the three packages (Studio `DarNode`, CDK
 * `DarNode`, model `DefinitionNode`), so we read these off a
 * `Record<string, unknown>` and scan whichever exist as strings. Kept in sync
 * with the fields validation scans for the same purpose.
 */
export const DEPENDENCY_CODE_FIELDS = [
  "code",
  "submitterCode",
  "itemsCode",
  "initialState",
  "stopCondition",
  "durationCode",
  "payload",
  "startInput",
  "input",
  "runIf",
  // `httpCall` carries its request in plain value fields rather than a code
  // body, but they interpolate upstream results exactly like one (`url` via a
  // template literal, the rest as JS expressions). Without them here, an edge
  // into an API-call node was classified ordering-only, so in DAG mode no
  // `deps` entry was passed and `${upstream}` silently resolved to the task
  // HANDLE instead of its result.
  "url",
  "headers",
  "query",
  "body",
] as const;

/** Escapes a string for safe use inside a `RegExp`. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `code` references the identifier `ident` on a word boundary.
 * Identifiers may contain `$`/`_`, so `\b` alone is unreliable — we assert the
 * chars on either side are not identifier characters (`[A-Za-z0-9_$]`).
 */
function referencesIdentifier(code: string, ident: string): boolean {
  if (!ident) return false;
  const re = new RegExp(
    `(^|[^A-Za-z0-9_$])${escapeRegExp(ident)}([^A-Za-z0-9_$]|$)`,
  );
  return re.test(code);
}

/**
 * Pulls the code-bearing string fields off a loosely-typed node, **recursing
 * into container bodies**. A container (`dagContainer`/`group`/`map` with a
 * `body`, `parallel` with `branches[].body`) consumes an upstream dependency
 * *inside its body* — through the shim identifier the codegen injects at the
 * container-task boundary — not in any field on the container node itself. So
 * to decide whether such a node references a source we must scan its whole
 * subtree, otherwise a container that clearly uses an upstream result would be
 * mis-inferred as ordering-only (dropping the shim it needs). Non-string
 * fields (e.g. a `.dar.ts` function reference, or an absent field) are skipped.
 */
function codeStringsOf(node: Record<string, unknown>): string[] {
  const out: string[] = [];
  const visit = (n: Record<string, unknown>): void => {
    for (const field of DEPENDENCY_CODE_FIELDS) {
      const value = n[field];
      if (typeof value === "string" && value.length > 0) out.push(value);
    }
    // Recurse into a single container body (dagContainer / group / map).
    const body = n.body as { nodes?: unknown } | undefined;
    if (body && Array.isArray(body.nodes)) {
      for (const child of body.nodes) {
        if (child && typeof child === "object")
          visit(child as Record<string, unknown>);
      }
    }
    // Recurse into parallel branch bodies.
    const branches = n.branches as { body?: { nodes?: unknown } }[] | undefined;
    if (Array.isArray(branches)) {
      for (const b of branches) {
        const bnodes = b?.body?.nodes;
        if (Array.isArray(bnodes)) {
          for (const child of bnodes) {
            if (child && typeof child === "object")
              visit(child as Record<string, unknown>);
          }
        }
      }
    }
  };
  visit(node);
  return out;
}

/**
 * True when the target node's code references the source — either an explicit
 * `deps["<sourceName>"]` / `deps['<sourceName>']` access, or a word-boundary
 * occurrence of the source's sanitized identifier `toIdentifier(sourceName)`
 * (the const the deps shim injects). The single reference test shared by
 * inference and any caller that wants the raw predicate.
 */
export function nodeReferencesSource(
  targetNode: Record<string, unknown>,
  sourceName: string,
): boolean {
  const ident = toIdentifier(sourceName);
  const depsDouble = `deps["${sourceName}"]`;
  const depsSingle = `deps['${sourceName}']`;
  for (const code of codeStringsOf(targetNode)) {
    if (code.includes(depsDouble) || code.includes(depsSingle)) return true;
    if (referencesIdentifier(code, ident)) return true;
  }
  return false;
}

/** Parameters for {@link inferDependencyKind}. */
export interface InferDependencyKindParams {
  /**
   * The dependent (downstream) node whose code may reference the source. Any
   * node shape works — only its code-bearing string fields
   * ({@link DEPENDENCY_CODE_FIELDS}) are read.
   */
  targetNode: Record<string, unknown>;
  /** The upstream source node's name (the `deps` map key / identifier root). */
  sourceName: string;
  /**
   * The edge's stored `dependencyKind`, if any — an explicit override honored
   * verbatim (returned as-is) when it is `"result"` or `"ordering"`.
   */
  explicit?: DarEdgeDependencyKind;
}

/**
 * Decides whether an edge from `sourceName` into `targetNode` is a `"result"`
 * or `"ordering"` dependency:
 *
 *   1. If `explicit` is a valid override, return it unchanged.
 *   2. Otherwise, `"result"` iff the target's code references the source
 *      (see {@link nodeReferencesSource}); `"ordering"` when it does not.
 *
 * Pure and deterministic — the same inputs always yield the same kind.
 */
export function inferDependencyKind(
  params: InferDependencyKindParams,
): DarEdgeDependencyKind {
  const { targetNode, sourceName, explicit } = params;
  if (explicit === "result" || explicit === "ordering") return explicit;
  return nodeReferencesSource(targetNode, sourceName) ? "result" : "ordering";
}
