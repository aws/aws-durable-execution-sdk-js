/**
 * Builds a source map from the generated handler back to the workflow's own
 * `.dar.ts` source text (see `docs/dar-ts-specification.md`), so a debugger
 * (in particular AWS Toolkit for VS Code's "Lambda remote debugging" — see
 * https://docs.aws.amazon.com/toolkit-for-vscode/latest/userguide/lambda-remote-debug.html,
 * which explicitly supports attaching a separate TypeScript source map to a
 * deployed Lambda's bundled JS) can resolve a breakpoint set in the `.dar.ts`
 * file to the right position in the code that is ACTUALLY executing.
 *
 * WHY `.dar.ts`, NOT THE JSON `.dar` (history — this module previously
 * targeted the JSON format; superseded per an explicit product decision):
 * the JSON `.dar` stores every node's `code` as a single-line, `\n`-escaped
 * JSON string, so a node's entire multi-statement body physically occupies
 * ONE line in that file — real per-statement breakpoints were never possible
 * there without a format change. `.dar.ts` (dar-ts-specification.md's Phase
 * 2, now the deploy artifact's format — see `WORKFLOW_DAR_TS_FILENAME` in
 * `darArtifact.ts`) stores each node's `code`/`submitterCode` as a genuine,
 * separately-declared, multi-line TypeScript function
 * (`async function <name>(<scope>) { ...real lines... }`) — so this module
 * can give STATEMENT-level granularity: each generated line inside a node's
 * block maps to the exact corresponding line inside that node's `.dar.ts`
 * function body, not just "the node's code starts here."
 *
 * HOW NODE BOUNDARIES ARE FOUND IN THE GENERATED TEXT: unchanged from the
 * JSON-targeting version — `generateHandler.ts`'s `emitChain` prepends an
 * invisible sentinel comment (`nodeMarker`, format `/*@dar:<nodeId>*\/`) as
 * its own line immediately before each node's real emitted line(s). This
 * module never sees `generateHandler`'s normal (marker-free) output — only
 * `generateHandlerMarked`'s.
 *
 * HOW FUNCTION BODY POSITIONS ARE FOUND IN THE `.dar.ts` SOURCE TEXT: the
 * TypeScript compiler API (`ts.createSourceFile`, static analysis only — the
 * file is never executed, matching `darTs.ts`'s own parser's security
 * posture) walks the file's top-level statements and records, for every
 * `function <name>(...) { ... }` declaration, the exact line each line of
 * its body starts at. The function name is `toIdentifier(node.name)` — the
 * SAME identifier `generateHandler.ts`'s `buildIdentifierMap` binds that
 * node's result to (dar-ts-specification.md §3.2 requires this to keep
 * definition and generated code in agreement) — so a `.dar` node id is
 * bridged to its `.dar.ts` function purely via `toIdentifier(node.name)`,
 * with no separate lookup table needed.
 */
import * as ts from "typescript";
import { SourceMapGenerator } from "source-map";
import { toIdentifier } from "@aws/durable-execution-sdk-js-visual-workflow-model";
import type { DarNode, DarWorkflow } from "./darModel";
import {
  BODY_MARKER_PREFIX,
  NODE_MARKER_PREFIX,
  generateHandlerMarked,
  type GenerateHandlerOptions,
} from "./generateHandler";

/** 1-based line, 0-based column — matches `source-map`'s own convention. */
export interface SourcePosition {
  line: number;
  column: number;
}

/**
 * Maps every top-level function DECLARED in `darTsSourceText` (by name) to
 * the array of 1-based line numbers its body spans, in order — i.e. `lines[0]`
 * is the line right after the opening `{`, `lines[k]` is that line plus `k`.
 * Only top-level `function`/`async function` declarations are considered
 * (matching exactly what `.dar.ts`'s own code functions are — see
 * dar-ts-specification.md §3.1); nothing inside `WorkflowDefinition`/
 * `WorkflowLayout` object literals is walked, since those never contain
 * function declarations of their own (per §4's restricted literal subset).
 * Pure static analysis via the TypeScript compiler API — the file's code is
 * never executed, mirroring `darTs.ts`'s `parseDarTs`'s own security posture.
 */
export function locateDarTsFunctionBodyLines(
  darTsSourceText: string,
): Map<string, number[]> {
  const sf = ts.createSourceFile(
    "workflow.dar.ts",
    darTsSourceText,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
  );
  const result = new Map<string, number[]>();

  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body) continue;
    const body = stmt.body;
    // The body's own line range, EXCLUDING the braces themselves: from the
    // line after `{` through the line before `}` — matching exactly the
    // span `dedent(source.slice(body.getStart(sf) + 1, body.getEnd() - 1))`
    // in `darTs.ts`'s parser extracts as the node's `code` text, so a line
    // index here corresponds 1:1 to a line index in that extracted text.
    const openBraceLine = sf.getLineAndCharacterOfPosition(
      body.getStart(sf),
    ).line;
    const closeBraceLine = sf.getLineAndCharacterOfPosition(
      body.getEnd() - 1,
    ).line;
    const lines: number[] = [];
    // 0-based -> 1-based; body content lines are strictly between the open
    // and close brace lines (excluding both), so `l` ranges up to but not
    // including `closeBraceLine`.
    for (let l = openBraceLine + 1; l < closeBraceLine; l += 1) {
      lines.push(l + 1);
    }
    // An empty body (`{}`, brace and closing brace on the same line) still
    // gets ONE entry (that line) so a node with blank code still has
    // somewhere to point a breakpoint at.
    if (lines.length === 0) lines.push(openBraceLine + 1);
    result.set(stmt.name.text, lines);
  }

  return result;
}

/**
 * Maps every node id declared in `darTsSourceText` to the 1-based line of that
 * node's `"id": "…"` property inside a workflow-definition literal — the line a
 * debugger breakpoint set "on the node" (as opposed to on a specific line of
 * its code body) should resolve to. Complements
 * {@link locateDarTsFunctionBodyLines}: that function finds where a node's CODE
 * lives (statement-level breakpoints); this one finds where the node itself is
 * DECLARED (its operation-entry breakpoint).
 *
 * Every top-level `const` whose initializer is an object literal with a
 * `nodes: [...]` array is treated as a workflow scope — this catches both the
 * exported root `workflow` const AND the flat, top-level child-workflow consts
 * the serializer emits for `map`/`group` bodies and `parallel` branches (named
 * e.g. `process_itemsBody`; see `darTs.ts`'s `workflowToDarTs`). For
 * robustness it ALSO recurses into any INLINE `body` object literal or
 * `branches: [{ body: { … } }]` array a node might carry directly (the
 * canonical serializer writes these as bare identifier references to separate
 * top-level consts, already walked above — but an inline literal is handled
 * correctly here regardless). Node ids are unique file-wide (spec guarantee),
 * so a single flat map suffices. Pure static analysis via the TypeScript
 * compiler API — the file is never executed, mirroring
 * {@link locateDarTsFunctionBodyLines}'s security posture.
 */
export function locateDarTsNodeLines(
  darTsSourceText: string,
): Map<string, number> {
  const sf = ts.createSourceFile(
    "workflow.dar.ts",
    darTsSourceText,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
  );
  const result = new Map<string, number>();

  const propName = (p: ts.PropertyAssignment): string | undefined =>
    ts.isIdentifier(p.name)
      ? p.name.text
      : ts.isStringLiteralLike(p.name)
        ? p.name.text
        : undefined;

  // Record one node object literal's id -> its `id` property's 1-based line,
  // then recurse into any inline container body/branches it carries.
  const recordNode = (nodeObj: ts.ObjectLiteralExpression): void => {
    for (const prop of nodeObj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = propName(prop);
      if (key === "id" && ts.isStringLiteralLike(prop.initializer)) {
        // ts line is 0-based; the map is 1-based (source-map convention).
        const line = sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line;
        result.set(prop.initializer.text, line + 1);
      } else if (
        key === "body" &&
        ts.isObjectLiteralExpression(prop.initializer)
      ) {
        walkContainerLiteral(prop.initializer);
      } else if (
        key === "branches" &&
        ts.isArrayLiteralExpression(prop.initializer)
      ) {
        for (const b of prop.initializer.elements) {
          if (!ts.isObjectLiteralExpression(b)) continue;
          for (const bp of b.properties) {
            if (
              ts.isPropertyAssignment(bp) &&
              propName(bp) === "body" &&
              ts.isObjectLiteralExpression(bp.initializer)
            ) {
              walkContainerLiteral(bp.initializer);
            }
          }
        }
      }
    }
  };

  // Walk a workflow-literal's `nodes: [...]` array, recording each element.
  function walkContainerLiteral(obj: ts.ObjectLiteralExpression): void {
    for (const prop of obj.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        propName(prop) === "nodes" &&
        ts.isArrayLiteralExpression(prop.initializer)
      ) {
        for (const el of prop.initializer.elements) {
          if (ts.isObjectLiteralExpression(el)) recordNode(el);
        }
      }
    }
  }

  // Every top-level const initialized to an object literal that has a `nodes`
  // array is a workflow scope (root `workflow` + flat child-workflow consts).
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (d.initializer && ts.isObjectLiteralExpression(d.initializer)) {
        walkContainerLiteral(d.initializer);
      }
    }
  }

  return result;
}

/**
 * Maps every node id declared in `darTsSourceText` to EVERY 1-based `.dar.ts`
 * line that belongs to that node: its `"id": "…"` declaration line (as
 * {@link locateDarTsNodeLines} returns) PLUS every line inside the body of
 * each function the node references — its `code`, `submitterCode`,
 * `itemsCode`, `conditionCode`, and so on.
 *
 * The question this answers is "which node does this line belong to?", which
 * is what a paused debugger needs in order to highlight the running node on
 * the visual canvas. {@link locateDarTsNodeLines} alone is not enough: a pause
 * on a statement INSIDE a step's body matches no declaration line, so the
 * canvas had nothing to highlight even though the pause was unambiguously
 * inside one node.
 *
 * A node is linked to its function by the IDENTIFIER it references, not by a
 * hard-coded list of property names: `.dar.ts` writes a node's code as
 * `code: Do_Work` (a reference to a separately declared top-level function —
 * dar-ts-specification.md §3.1/§3.2), so any property whose initializer is an
 * identifier that names one of this file's top-level functions is treated as
 * that node's code. That keeps this correct as new code-carrying fields are
 * added, and ignores identifiers that name something else (a child-workflow
 * const referenced by `body`, for instance, which is a container's structure
 * rather than a node's code).
 *
 * Pure static analysis via the TypeScript compiler API — the file is never
 * executed, mirroring the security posture of the functions above.
 */
export function locateDarTsNodeSourceLines(
  darTsSourceText: string,
): Map<string, number[]> {
  const functionLines = locateDarTsFunctionBodyLines(darTsSourceText);
  const sf = ts.createSourceFile(
    "workflow.dar.ts",
    darTsSourceText,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
  );
  const result = new Map<string, number[]>();

  const propName = (p: ts.PropertyAssignment): string | undefined =>
    ts.isIdentifier(p.name)
      ? p.name.text
      : ts.isStringLiteralLike(p.name)
        ? p.name.text
        : undefined;

  const recordNode = (nodeObj: ts.ObjectLiteralExpression): void => {
    let nodeId: string | undefined;
    const lines: number[] = [];
    for (const prop of nodeObj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = propName(prop);
      if (key === "id" && ts.isStringLiteralLike(prop.initializer)) {
        nodeId = prop.initializer.text;
        lines.push(
          sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line + 1,
        );
      } else if (
        ts.isIdentifier(prop.initializer) &&
        functionLines.has(prop.initializer.text)
      ) {
        // A reference to one of this file's top-level functions: that
        // function's body lines are this node's code.
        lines.push(...(functionLines.get(prop.initializer.text) as number[]));
      } else if (
        key === "body" &&
        ts.isObjectLiteralExpression(prop.initializer)
      ) {
        walkContainerLiteral(prop.initializer);
      } else if (
        key === "branches" &&
        ts.isArrayLiteralExpression(prop.initializer)
      ) {
        for (const b of prop.initializer.elements) {
          if (!ts.isObjectLiteralExpression(b)) continue;
          for (const bp of b.properties) {
            if (
              ts.isPropertyAssignment(bp) &&
              propName(bp) === "body" &&
              ts.isObjectLiteralExpression(bp.initializer)
            ) {
              walkContainerLiteral(bp.initializer);
            }
          }
        }
      }
    }
    if (nodeId !== undefined) {
      result.set(
        nodeId,
        [...new Set(lines)].sort((a, b) => a - b),
      );
    }
  };

  function walkContainerLiteral(obj: ts.ObjectLiteralExpression): void {
    for (const prop of obj.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        propName(prop) === "nodes" &&
        ts.isArrayLiteralExpression(prop.initializer)
      ) {
        for (const el of prop.initializer.elements) {
          if (ts.isObjectLiteralExpression(el)) recordNode(el);
        }
      }
    }
  }

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (d.initializer && ts.isObjectLiteralExpression(d.initializer)) {
        walkContainerLiteral(d.initializer);
      }
    }
  }

  return result;
}

/**
 * The id of the node that owns the 1-based `.dar.ts` line `darLine` — its
 * declaration line or any line of its code body (see
 * {@link locateDarTsNodeSourceLines}), or undefined when the line belongs to
 * no node (blank lines, the workflow literal's own scaffolding, `meta`).
 *
 * Convenience over {@link locateDarTsNodeSourceLines} for the common
 * single-line question a paused debugger asks. Callers resolving many lines
 * should build the map once and search it themselves.
 */
export function darTsNodeIdForLine(
  darTsSourceText: string,
  darLine: number,
): string | undefined {
  for (const [nodeId, lines] of locateDarTsNodeSourceLines(darTsSourceText)) {
    if (lines.includes(darLine)) return nodeId;
  }
  return undefined;
}
function allNodes(wf: DarWorkflow): DarNode[] {
  const out: DarNode[] = [];
  const visit = (w: DarWorkflow) => {
    for (const n of w.nodes) {
      out.push(n);
      if ((n.kind === "map" || n.kind === "group") && n.body) {
        visit(n.body as DarWorkflow);
      }
      if (n.kind === "parallel" && Array.isArray(n.branches)) {
        for (const b of n.branches as { body: DarWorkflow }[]) {
          if (b.body) visit(b.body);
        }
      }
    }
  };
  visit(wf);
  return out;
}

/**
 * Builds a V3 source map for `markedHandlerSrc` (the marker-carrying output
 * of `generateHandlerMarked`, BEFORE markers are stripped) that resolves each
 * generated line back to the exact `.dar.ts` line of the node's function
 * body that produced it, using `darSourceFileName` as the map's `sources`
 * entry (a path the debugger can actually open — see `deploy.ts` for how
 * this is wired to a real, persistent on-disk `.dar.ts` file). Returns the
 * STRIPPED handler source (markers removed, byte-identical to what
 * `generateHandler` would return) alongside the map, so callers get both in
 * one pass without re-running codegen.
 */
export function buildHandlerSourceMap(
  markedHandlerSrc: string,
  wf: DarWorkflow,
  darTsSourceText: string,
  darSourceFileName: string,
): { code: string; map: string } {
  const functionLines = locateDarTsFunctionBodyLines(darTsSourceText);
  // node id -> 1-based line of that node's `"id": "…"` property in the .dar.ts
  // workflow literal (the node's operation-entry breakpoint target).
  const nodeLines = locateDarTsNodeLines(darTsSourceText);
  // node id -> its .dar.ts function name (toIdentifier(node.name), the same
  // identifier generateHandler.ts's buildIdentifierMap assigns).
  const idToFnName = new Map<string, string>();
  for (const n of allNodes(wf)) idToFnName.set(n.id, toIdentifier(n.name));

  const generator = new SourceMapGenerator({ file: "handler.ts" });
  generator.setSourceContent(darSourceFileName, darTsSourceText);

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nodeMarkerRe = new RegExp(
    `^[ \\t]*${esc(NODE_MARKER_PREFIX)}([^*]+)\\*/\\s*$`,
  );
  const bodyStartRe = new RegExp(
    `^[ \\t]*${esc(BODY_MARKER_PREFIX)}start\\*/\\s*$`,
  );
  const bodyEndRe = new RegExp(
    `^[ \\t]*${esc(BODY_MARKER_PREFIX)}end\\*/\\s*$`,
  );

  const inputLines = markedHandlerSrc.split("\n");
  const outputLines: string[] = [];
  // The CURRENT node's .dar.ts body lines (set by the most recent node
  // marker; undefined = no mapping, e.g. a node kind with no verbatim body
  // like `wait`/`chainInvoke`/`map`/`parallel`'s own wrapper lines).
  let currentBodyLines: number[] | undefined;
  // Whether we're currently BETWEEN a bodyStart/bodyEnd marker pair — only
  // lines in that range get a body-line mapping; wrapper lines (the
  // `await ctx.step(name, async () => {` opener, the closing
  // `}, { retryStrategy: ... })`, etc.) are deliberately left unmapped
  // (source-map generators without an addMapping for a generated line just
  // fall back to the nearest preceding mapping when queried — acceptable:
  // that nearest mapping is still the right node, just not a specific line
  // inside it).
  let inBody = false;
  let bodyLineIdx = 0;
  let outLineNo = 1; // 1-based, matches source-map convention
  // Set when a node marker is consumed; holds that node's id until the NEXT
  // emitted (non-marker) line — the node's OPERATION/wrapper line (e.g. the
  // `await ctx.step(name, async () => {` opener, or `await ctx.wait(...)`).
  // That first emitted line is mapped to the node's `.dar.ts` DECLARATION line
  // (its `"id": "…"` property), so a debugger breakpoint set on the node itself
  // pauses at the operation entry — distinct from the body-line mappings below,
  // which resolve statement breakpoints inside the node's code. Additive: the
  // existing body-line mappings are untouched.
  let pendingNodeId: string | undefined;

  for (const rawLine of inputLines) {
    const nm = nodeMarkerRe.exec(rawLine);
    if (nm) {
      // A node marker is consumed (not emitted) — it selects which node's
      // .dar.ts function body the NEXT bodyStart/bodyEnd pair walks through.
      const fnName = idToFnName.get(nm[1]);
      currentBodyLines = fnName ? functionLines.get(fnName) : undefined;
      inBody = false;
      pendingNodeId = nm[1];
      continue;
    }
    if (bodyStartRe.test(rawLine)) {
      inBody = true;
      bodyLineIdx = 0;
      continue; // marker itself is consumed, not emitted
    }
    if (bodyEndRe.test(rawLine)) {
      inBody = false;
      continue;
    }
    outputLines.push(rawLine);
    // The first emitted line after a node marker is that node's operation/
    // wrapper line — map it to the node's `.dar.ts` declaration line.
    if (pendingNodeId !== undefined) {
      const declLine = nodeLines.get(pendingNodeId);
      if (declLine !== undefined) {
        generator.addMapping({
          generated: { line: outLineNo, column: 0 },
          original: { line: declLine, column: 0 },
          source: darSourceFileName,
        });
      }
      pendingNodeId = undefined;
    }
    if (inBody && currentBodyLines && currentBodyLines.length > 0) {
      // Clamp to the last body line in case a node's body (per
      // generateHandler.ts's own fallback text, e.g. "return undefined;")
      // is shorter than what locateDarTsFunctionBodyLines reports, or vice
      // versa — keeps this robust rather than throwing on a mismatch.
      const idx = Math.min(bodyLineIdx, currentBodyLines.length - 1);
      generator.addMapping({
        generated: { line: outLineNo, column: 0 },
        original: { line: currentBodyLines[idx], column: 0 },
        source: darSourceFileName,
      });
      bodyLineIdx += 1;
    }
    outLineNo += 1;
  }

  return { code: outputLines.join("\n"), map: generator.toString() };
}

/**
 * Generates the same handler as `generateHandler.ts`'s `generateHandler`, but
 * ALSO returns a V3 source map resolving each generated line back to the
 * exact `.dar.ts` line that produced it — statement-level granularity (see
 * this file's top doc comment). `darTsSourceText` must be the workflow's real
 * `.dar.ts` text (see `darTs.ts`'s `workflowToDarTs`, in the VS Code
 * extension package — this package stays vscode-free, so callers convert
 * before calling this); `darSourceFileName` should be a real path the
 * consuming debugger (e.g. AWS Toolkit's Lambda remote debugging) can open,
 * since it becomes the map's `sources` entry.
 */
export function generateHandlerWithMap(
  wf: DarWorkflow,
  darTsSourceText: string,
  darSourceFileName: string,
  /**
   * Same options as {@link generateHandler}. Without this, source-map generation
   * did not pass `allowDagMode` through, so a dag workflow would still be refused
   * here even with the opt-in set — debugging would break for the one case the
   * opt-in exists to enable.
   */
  opts?: GenerateHandlerOptions,
): { code: string; map: string } {
  const marked = generateHandlerMarked(wf, opts);
  return buildHandlerSourceMap(marked, wf, darTsSourceText, darSourceFileName);
}
