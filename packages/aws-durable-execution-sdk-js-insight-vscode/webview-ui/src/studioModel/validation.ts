import {
  NODE_KIND_LABELS,
  RESERVED_IDENTIFIERS,
  TRIGGER_RULES,
  flowEdges,
  isDagWorkflow,
  isLinearWorkflow,
  isOperationKind,
  toIdentifier,
} from "./model";
import { DEPENDENCY_CODE_FIELDS } from "@aws/durable-execution-sdk-js-visual-workflow-model";
import type { DarNode, DarWorkflow } from "./model";

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  /** The node the issue is about, if any (lets the UI select it). */
  nodeId?: string;
  /** Multiple nodes an issue implicates (e.g. every node in a cycle). */
  nodeIds?: string[];
}

/**
 * Structural validation of a workflow graph. Pure and side-effect-free so it
 * can run on every edit (and later be reused by the CDK codegen / deploy).
 *
 * Checks: exactly one start; at least one end; every non-start node has an
 * incoming edge ("no previous node"); every non-end node has an outgoing edge
 * ("no next node"); and nodes that have a predecessor but are still not
 * reachable from start (disconnected subgraphs / isolated cycles).
 */
/**
 * Whether brackets and quotes balance. A cheap stand-in for parsing, used where
 * a real parser isn't available (the webview bundles no TypeScript, and the CSP
 * forbids `eval`/`new Function`). Only reports input that is unambiguously
 * broken — it must never reject a valid expression, since the authoritative
 * check runs in the generator on the host.
 */
export function isBalanced(text: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\")
        i++; // skip the escaped character
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") stack.push(c);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== pairs[c]) return false;
    }
  }
  return quote === null && stack.length === 0;
}

export function validateWorkflow(wf: DarWorkflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { nodes, edges } = wf;

  const starts = nodes.filter((n) => n.kind === "start");
  // "Exactly one start" is a LINEAR-scope rule. A dag scope has no start node
  // at all — a ROOT is simply a task with no dependencies (`deps: []`) — so
  // these checks must not fire in a dag scope.
  if (isLinearWorkflow(wf)) {
    if (starts.length === 0) {
      issues.push({ level: "error", message: "Workflow has no start node." });
    } else if (starts.length > 1) {
      issues.push({
        level: "error",
        message: "Workflow has more than one start node.",
      });
    }
  }
  // A linear scope ends by marking a node terminal (which owns an `end` node).
  // A dag scope legitimately has no `end` node — it completes by draining / its
  // completion policy — so this warning is linear-only.
  if (isLinearWorkflow(wf) && !nodes.some((n) => n.kind === "end")) {
    issues.push({
      level: "warning",
      message: "Workflow has no end — mark a node terminal to end it.",
    });
  }
  // Defensive: a `start` kind node in a dag scope is meaningless — the SDK has
  // no start; root tasks are those with no dependencies.
  if (isDagWorkflow(wf) && nodes.some((n) => n.kind === "start")) {
    issues.push({
      level: "warning",
      message:
        "start nodes are not used in a DAG — root tasks are those with no dependencies.",
    });
  }
  // Defensive: an `end` kind node in a dag scope is meaningless — a DAG
  // completes by its completion policy, not an end node.
  if (isDagWorkflow(wf) && nodes.some((n) => n.kind === "end")) {
    issues.push({
      level: "warning",
      message:
        "end nodes are not used in a DAG — a DAG completes by its completion policy.",
    });
  }

  // All routing is edges — error routes included — so incoming/outgoing sets
  // come straight from the edge list. (Note: an error edge counts as an exit
  // for "no next node" purposes, matching previous behavior for error routes.)
  const incoming = new Set(edges.map((e) => e.target));
  const outgoing = new Set(edges.map((e) => e.source));
  const label = (n: DarNode) =>
    `${NODE_KIND_LABELS[n.kind]} "${n.name || "(unnamed)"}"`;

  // Duplicate operation names (start/end markers are excluded — many `end`
  // nodes legitimately share the name "end").
  const byName = new Map<string, DarNode[]>();
  for (const n of nodes) {
    if (!isOperationKind(n.kind)) continue;
    const key = n.name.trim();
    if (!key) continue;
    const list = byName.get(key);
    if (list) list.push(n);
    else byName.set(key, [n]);
  }
  for (const [name, group] of byName) {
    if (group.length > 1) {
      issues.push({
        level: "error",
        message: `Duplicate node name "${name}" — used by ${group.length} nodes.`,
        nodeIds: group.map((n) => n.id),
      });
    }
  }

  // Identifier integrity: each operation node's result const is
  // `toIdentifier(name)`. Two distinct names that sanitize to the same
  // identifier, or a name that maps to a reserved identifier, would desync the
  // generated code from the "Edit in VS Code" scaffold — flag both.
  const byIdent = new Map<string, DarNode[]>();
  for (const n of nodes) {
    if (!isOperationKind(n.kind) || !n.name.trim()) continue;
    const id = toIdentifier(n.name);
    if (RESERVED_IDENTIFIERS.has(id)) {
      issues.push({
        level: "error",
        message: `${label(n)} maps to the reserved identifier "${id}" — rename it.`,
        nodeId: n.id,
      });
    }
    const list = byIdent.get(id);
    if (list) list.push(n);
    else byIdent.set(id, [n]);
  }
  for (const [id, group] of byIdent) {
    if (group.length > 1) {
      issues.push({
        level: "error",
        message: `Nodes ${group
          .map((n) => `"${n.name}"`)
          .join(
            ", ",
          )} map to the same identifier "${id}" — names must be unique after sanitizing.`,
        nodeIds: group.map((n) => n.id),
      });
    }
  }

  // A condition may have at most one else (no-match) branch. Error edges out
  // of a condition are not branches.
  for (const n of nodes) {
    if (n.kind !== "condition") continue;
    const elses = edges.filter(
      (e) => e.source === n.id && e.kind !== "error" && !(e.match ?? "").trim(),
    );
    if (elses.length > 1) {
      issues.push({
        level: "error",
        message: `${label(n)} has ${elses.length} else branches — keep at most one.`,
        nodeId: n.id,
      });
    }
  }

  // Linear (1:1) workflows: every node starts at most one next node. Condition
  // nodes are exempt — their outgoing edges are branches and only one is taken
  // at runtime. Error edges are exempt too (they run only on failure).
  if (isLinearWorkflow(wf)) {
    const outCount = new Map<string, number>();
    const inCount = new Map<string, number>();
    const byIdLocal = new Map(nodes.map((n) => [n.id, n]));
    for (const e of edges) {
      if (e.kind === "error") continue;
      outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1);
      // Convergence of condition branches is a legitimate linear pattern (only
      // one branch is taken at runtime), so branch edges don't count as
      // fan-in — only plain flow edges do.
      if (byIdLocal.get(e.source)?.kind !== "condition") {
        inCount.set(e.target, (inCount.get(e.target) ?? 0) + 1);
      }
    }
    for (const n of nodes) {
      if (n.kind !== "condition") {
        const c = outCount.get(n.id) ?? 0;
        if (c > 1) {
          issues.push({
            level: "error",
            message: `${label(n)} has ${c} next nodes — this workflow is 1:1 (at most one next per node).`,
            nodeId: n.id,
          });
        }
      }
      // Fan-in is likewise not expressible in a 1:1 workflow: a node reached by
      // more than one plain flow edge is a join, which only DAG mode supports.
      // Surfaced as a warning (not an error) so switching a DAG scope to linear
      // flags the affected nodes without silently deleting their edges (P3.1).
      if (n.kind !== "end") {
        const ci = inCount.get(n.id) ?? 0;
        if (ci > 1) {
          issues.push({
            level: "warning",
            message: `${label(n)} has ${ci} incoming connections — this workflow is 1:1 (at most one previous per node). Switch this scope to DAG mode to keep multiple dependencies.`,
            nodeId: n.id,
          });
        }
      }
    }
  }

  // Error handling: `"error"` edges (routes) and onError branches (fallbacks)
  // are supported only on some kinds; at most one catch-all across both.
  const ERROR_SUPPORTED = new Set<DarNode["kind"]>([
    "step",
    "inline",
    "callback",
    "chainInvoke",
    "waitForCondition",
    "map",
    "group",
    "parallel",
    "awsJob",
  ]);
  for (const n of nodes) {
    const routes = edges.filter((e) => e.kind === "error" && e.source === n.id);
    const fallbacks = n.onError ?? [];
    if (routes.length === 0 && fallbacks.length === 0) continue;
    if (!ERROR_SUPPORTED.has(n.kind)) {
      issues.push({
        level: "warning",
        message: `${label(n)} does not support error handling — its error branches are ignored.`,
        nodeId: n.id,
      });
      continue;
    }
    for (const b of fallbacks) {
      if (typeof b.fallbackCode !== "string") {
        issues.push({
          level: "warning",
          message: `${label(n)} has an error branch with no target or fallback.`,
          nodeId: n.id,
        });
      }
    }
    const catchAlls = [
      ...routes.filter((e) => !(e.errorType ?? "").trim()),
      ...fallbacks.filter((b) => !(b.errorType ?? "").trim()),
    ];
    if (catchAlls.length > 1) {
      issues.push({
        level: "warning",
        message: `${label(n)} has ${catchAlls.length} catch-all error branches — only the first is used.`,
        nodeId: n.id,
      });
    }
  }

  for (const n of nodes) {
    // "No previous node" is a linear-mode rule. In a dag scope a task with no
    // incoming edge is a legitimate ROOT task (`deps: []`, §8 / P4.1), so we do
    // not flag it. Reachability is still surfaced by the disconnected-subgraph
    // warning below for nodes that DO have a predecessor.
    if (n.kind !== "start" && !incoming.has(n.id) && !isDagWorkflow(wf)) {
      issues.push({
        level: "error",
        message: `${label(n)} has no previous node.`,
        nodeId: n.id,
      });
    }
    // "No next node" is a linear-mode rule. In a dag scope a LEAF task (no
    // outgoing edge) is normal and expected — the DAG drains when its leaves
    // finish — so we only flag it in linear scopes.
    if (n.kind !== "end" && !outgoing.has(n.id) && isLinearWorkflow(wf)) {
      issues.push({
        level: "error",
        message: `${label(n)} has no next node.`,
        nodeId: n.id,
      });
    }
    // A dynamic wait duration is either a bare expression or a block that
    // returns. A block with no `return` compiles fine and evaluates to
    // `undefined`, giving `{ seconds: undefined }` — silent at deploy time.
    if (n.kind === "wait") {
      const dc = (n as unknown as Record<string, unknown>).durationCode;
      if (typeof dc === "string" && dc.trim() !== "") {
        const t = dc.trim();
        const isStatements =
          /\breturn\b|\b(const|let|var|if|for|while|throw)\b|;/.test(t);
        if (isStatements && !/\breturn\b/.test(t)) {
          issues.push({
            level: "error",
            message: `${label(n)}'s dynamic duration never returns a value, so the wait would be undefined. End it with \`return <seconds>;\`, or use a bare expression like \`12\`.`,
            nodeId: n.id,
          });
        }
      }
    }
    // An API call's query/headers/body are emitted as JS VALUE expressions, so
    // they have two failure modes a plain text field can't show. Both are quiet
    // at deploy time, which is exactly why they're flagged here.
    if (n.kind === "httpCall") {
      const rec = n as unknown as Record<string, unknown>;
      for (const field of ["query", "headers", "body"] as const) {
        const raw = rec[field];
        if (typeof raw !== "string" || raw.trim() === "") continue;
        const text = raw.trim();

        // `${…}` only interpolates in the URL (emitted as a template literal).
        // Inside these fields it lands in a double-quoted JSON string, where it
        // is literal text — so the placeholder gets SENT to the API verbatim.
        let isJson = false;
        try {
          JSON.parse(text);
          isJson = true;
        } catch {
          isJson = false;
        }
        if (isJson && /\$\{[^}]*\}/.test(text)) {
          issues.push({
            level: "error",
            message:
              `${label(n)}'s ${field} uses \${…} inside a quoted string, which is sent literally. ` +
              `Reference the value directly instead, e.g. { "id": step_name.id }. \${…} only works in the URL.`,
            nodeId: n.id,
          });
          continue;
        }
        // Not JSON means it's emitted as raw code. A full parse would need the
        // TypeScript compiler, which the webview doesn't bundle — and `new
        // Function` is NOT an option: neither host's CSP grants `unsafe-eval`,
        // so it throws EvalError and would have failed EVERY legitimate
        // expression (`{ id: step.id }` included) as invalid.
        //
        // So this only catches unambiguously broken input — unbalanced brackets
        // or quotes. The authoritative parse happens in the generator
        // (`isExpressionText`), which runs on the host where TypeScript is
        // available. Deliberately conservative: a false error here would block a
        // correct workflow, which is worse than missing a malformed one that
        // codegen will reject anyway.
        if (!isJson && !isBalanced(text)) {
          issues.push({
            level: "error",
            message: `${label(n)}'s ${field} has unbalanced brackets or quotes.`,
            nodeId: n.id,
          });
        }
      }
    }
  }

  // Disconnected subgraphs: nodes that have a predecessor but still aren't
  // reachable from a start (e.g. an isolated cycle). Nodes with no predecessor
  // are already reported above, so skip them here to avoid duplicate noise.
  // This is a LINEAR-scope rule: it uses `start` nodes as DFS roots, and a dag
  // scope has no start to reach from (isolated cycles there are independently
  // caught by the cycle-detection block below).
  if (isLinearWorkflow(wf) && starts.length > 0) {
    const adj = new Map<string, string[]>();
    const pushEdge = (source: string, target: string) => {
      const list = adj.get(source);
      if (list) list.push(target);
      else adj.set(source, [target]);
    };
    for (const e of edges) pushEdge(e.source, e.target);
    // Error edges are in `edges`, so error-route targets count as reachable.
    const seen = new Set<string>();
    const stack = starts.map((s) => s.id);
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const t of adj.get(id) ?? []) stack.push(t);
    }
    for (const n of nodes) {
      if (n.kind !== "start" && incoming.has(n.id) && !seen.has(n.id)) {
        issues.push({
          level: "warning",
          message: `${label(n)} is not reachable from start.`,
          nodeId: n.id,
        });
      }
    }
  }

  // Circular dependency detection (DFS with a recursion stack). Reports the
  // first cycle found; fixing it and re-validating surfaces any others.
  // Error edges are excluded: a "retry loop" (A --error--> B --> A) is a
  // legitimate pattern the generator guards with its visited set.
  {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (e.kind === "error") continue;
      const l = adj.get(e.source);
      if (l) l.push(e.target);
      else adj.set(e.source, [e.target]);
    }
    // 1 = on current DFS stack, 2 = fully explored.
    const state = new Map<string, 1 | 2>();
    const path: string[] = [];
    let cycle: string[] | null = null;
    const dfs = (id: string): boolean => {
      state.set(id, 1);
      path.push(id);
      for (const t of adj.get(id) ?? []) {
        const st = state.get(t);
        if (st === 1) {
          cycle = path.slice(path.indexOf(t));
          return true;
        }
        if (st === undefined && dfs(t)) return true;
      }
      path.pop();
      state.set(id, 2);
      return false;
    };
    for (const n of nodes) {
      if (state.get(n.id) === undefined && dfs(n.id)) break;
    }
    if (cycle) {
      const cyclePath: string[] = cycle;
      const names = cyclePath.map((id) => {
        const nn = nodes.find((n) => n.id === id);
        return nn ? nn.name || NODE_KIND_LABELS[nn.kind] : id;
      });
      issues.push({
        level: "error",
        message: `Circular dependency: ${[...names, names[0]].join(" → ")}`,
        nodeIds: cyclePath,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // DAG-scope-only checks (§4.1–4.4, §8). All gated on `isDagWorkflow(wf)` so
  // linear scopes are completely unaffected. `validateWorkflow` runs per active
  // scope (not recursively), so these fire for whichever scope is being
  // validated — including a `dagContainer` node's body, whose own
  // `dependencyMode` is `"dag"` (see model.ts createNode/parseWorkflow).
  // ---------------------------------------------------------------------------
  if (isDagWorkflow(wf)) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const flow = flowEdges(edges);

    // Incoming edges per node, split by dependency semantics. Result edges
    // inject `const <ident> = deps["<src>"]`; ordering edges (the SDK's
    // `.after()`) inject nothing. Error edges are handled separately (check 2).
    const resultDepsOf = (nodeId: string) =>
      flow.filter(
        (e) => e.target === nodeId && e.dependencyKind !== "ordering",
      );
    const orderingDepsOf = (nodeId: string) =>
      flow.filter(
        (e) => e.target === nodeId && e.dependencyKind === "ordering",
      );

    // Names that a `deps["<key>"]` access (or its injected const identifier)
    // may legitimately resolve to for this node. We match a deps key against
    // both the source's raw name (the deps map key, e.g. "fetch-users") and its
    // sanitized identifier (the injected const, e.g. "fetch_users").
    const srcNamesFor = (edgesIn: typeof flow): Set<string> => {
      const s = new Set<string>();
      for (const e of edgesIn) {
        const src = byId.get(e.source);
        if (src && src.name.trim()) {
          s.add(src.name.trim());
          s.add(toIdentifier(src.name));
        }
      }
      return s;
    };
    // Every incoming edge source (result + ordering + error) — used to decide
    // whether a `deps[...]` key is "known" at all (check 4 under-reports rather
    // than flag an ordering-source read that check 3 already owns).
    const allIncomingNames = (nodeId: string): Set<string> => {
      const s = new Set<string>();
      for (const e of edges) {
        if (e.target !== nodeId) continue;
        const src = byId.get(e.source);
        if (src && src.name.trim()) {
          s.add(src.name.trim());
          s.add(toIdentifier(src.name));
        }
      }
      return s;
    };

    // Value/code-bearing fields a task may reference a dependency from. Shared
    // with `inferDependencyKind` so the two can never disagree about whether an
    // edge carries a result — they previously kept separate copies of this list.
    const CODE_FIELDS = DEPENDENCY_CODE_FIELDS;
    const codeStringsOf = (n: DarNode): string[] => {
      const rec = n as unknown as Record<string, unknown>;
      const out: string[] = [];
      for (const f of CODE_FIELDS) {
        const v = rec[f];
        if (typeof v === "string" && v.trim()) out.push(v);
      }
      return out;
    };
    const depsKeysIn = (code: string): string[] => {
      const re = /deps\s*\[\s*['"]([^'"]+)['"]\s*\]/g;
      const keys: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) keys.push(m[1]);
      return keys;
    };
    const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const referencesIdentifier = (code: string, ident: string): boolean => {
      if (!ident) return false;
      // Manual word boundaries: identifiers may contain `$`/`_`, so `\b` alone
      // is unreliable. A bare-identifier match is a heuristic (may hit strings
      // or comments), so its findings are downgraded to warnings below.
      const re = new RegExp(`(^|[^\\w$])${escapeReg(ident)}([^\\w$]|$)`);
      return re.test(code);
    };

    // 1) `inline` node in a dag scope (§4.2) → error.
    for (const n of nodes) {
      if (n.kind === "inline") {
        issues.push({
          level: "error",
          message: `${label(
            n,
          )}: inline is not supported in a DAG — fold it into the consuming task or use a step.`,
          nodeId: n.id,
        });
      }
    }

    // 2) Typed `"error"` edge in a dag scope (§4.3) → error. An UNTYPED (blank
    // errorType) error edge is the allowed catch-all — it lowers to
    // `.after(src)` + `ANY_FAILED`.
    for (const e of edges) {
      if (e.kind !== "error") continue;
      if (!(e.errorType ?? "").trim()) continue;
      const src = byId.get(e.source);
      issues.push({
        level: "error",
        message: `${
          src ? label(src) : "An error edge"
        }: typed error routes aren’t supported in a DAG; use an onError fallback for typed recovery, or an untyped error edge for run-on-failure.`,
        nodeId: e.source,
      });
    }

    for (const n of nodes) {
      if (!isOperationKind(n.kind)) continue;
      const resultEdges = resultDepsOf(n.id);
      const orderingEdges = orderingDepsOf(n.id);
      const resultNames = srcNamesFor(resultEdges);
      const bodyStrings = codeStringsOf(n);

      // 3) Ordering-edge result read (§8): the node reads `deps["<src>"]` (or the
      // injected identifier) of a dependency it declared ORDERING-only, whose
      // result is therefore never injected. A clear `deps["name"]` access is an
      // ERROR; a bare-identifier match is a conservative WARNING (heuristic),
      // and is suppressed when a result dep shares the same identifier (to avoid
      // flagging a legitimate result read).
      for (const e of orderingEdges) {
        const src = byId.get(e.source);
        if (!src || !src.name.trim()) continue;
        const rawName = src.name.trim();
        const ident = toIdentifier(rawName);
        let reportedError = false;
        for (const code of bodyStrings) {
          const keys = depsKeysIn(code);
          if (keys.includes(rawName) || keys.includes(ident)) {
            issues.push({
              level: "error",
              message: `${label(
                n,
              )} reads deps["${rawName}"], but its dependency on "${rawName}" is ordering-only — an ordering dependency injects no result. Make the edge a result dependency, or stop reading its value.`,
              nodeId: n.id,
            });
            reportedError = true;
            break;
          }
        }
        if (reportedError) continue;
        // Bare-identifier heuristic (warning). Skip when a result dep sanitizes
        // to the same identifier — then the reference is plausibly legitimate.
        if (resultNames.has(ident)) continue;
        if (bodyStrings.some((code) => referencesIdentifier(code, ident))) {
          issues.push({
            level: "warning",
            message: `${label(
              n,
            )} may reference "${ident}", the result of an ordering-only dependency — ordering dependencies inject no result. If you need its value, make the edge a result dependency.`,
            nodeId: n.id,
          });
        }
      }

      // 4) `runIf` / `triggerRule` reference to a non-dependency (§8).
      // triggerRule is an enum — validate membership only (no free refs).
      if (n.triggerRule !== undefined) {
        if (!(TRIGGER_RULES as readonly string[]).includes(n.triggerRule)) {
          issues.push({
            level: "error",
            message: `${label(n)} has an unknown trigger rule "${
              n.triggerRule
            }".`,
            nodeId: n.id,
          });
        }
      }
      // runIf may only read `deps[...]` for actual dependencies of this task.
      // A key that matches NO incoming edge source (result, ordering, or error)
      // is a reference to a task this one does not depend on → error. (An
      // ordering-source read is owned by check 3, not double-reported here.)
      if (typeof n.runIf === "string" && n.runIf.trim()) {
        const known = allIncomingNames(n.id);
        const seen = new Set<string>();
        for (const key of depsKeysIn(n.runIf)) {
          if (known.has(key) || seen.has(key)) continue;
          seen.add(key);
          issues.push({
            level: "error",
            message: `${label(
              n,
            )} runIf references "${key}" which is not a dependency of this task.`,
            nodeId: n.id,
          });
        }
      }

      // 7) Injected-dep / inner-identifier collision (§4.4): two incoming RESULT
      // dependencies whose source names sanitize to the same identifier would
      // emit two `const <ident> = deps[...]` shims that clobber each other.
      const identToNames = new Map<string, Set<string>>();
      for (const e of resultEdges) {
        const src = byId.get(e.source);
        if (!src || !src.name.trim()) continue;
        const ident = toIdentifier(src.name);
        const set = identToNames.get(ident) ?? new Set<string>();
        set.add(src.name.trim());
        identToNames.set(ident, set);
      }
      for (const [ident, names] of identToNames) {
        if (names.size > 1) {
          issues.push({
            level: "error",
            message: `${label(n)} has dependencies ${[...names]
              .map((x) => `"${x}"`)
              .join(
                ", ",
              )} that map to the same injected identifier "${ident}" — rename one so the deps shims don't collide.`,
            nodeId: n.id,
          });
        }
      }
    }

    // 5) completionConfig mutual exclusivity (§8): the custom predicate form
    // (`shouldComplete`) and the threshold form (`minSuccessful` /
    // `toleratedFailureCount` / `toleratedFailurePercentage`) are mutually
    // exclusive (mirrors the SDK's `DagCustomCompletionConfig` `never` fields).
    {
      const cc = wf.dagConfig?.completionConfig as
        | Record<string, unknown>
        | undefined;
      if (cc) {
        const hasCustom =
          typeof cc.shouldComplete === "string" && cc.shouldComplete.trim()
            ? true
            : false;
        const hasThreshold = [
          "minSuccessful",
          "toleratedFailureCount",
          "toleratedFailurePercentage",
        ].some((k) => cc[k] !== undefined);
        if (hasCustom && hasThreshold) {
          issues.push({
            level: "error",
            message:
              "DAG completion config sets a custom shouldComplete predicate and threshold fields together — they are mutually exclusive; keep one form.",
          });
        }
      }
    }

    // 6) Condition re-convergence warning (§4.1): with condition lowered to
    // per-branch `runIf`, branches skip independently. A task that fans in from
    // more than one branch of the SAME condition node under the default trigger
    // rule (ALL_SUCCESS / unset) may never run — warn. Heuristic (kept simple
    // to avoid false positives): only DIRECT condition-branch targets are
    // considered "branches"; we warn only when ≥2 of a node's incoming result
    // sources are direct branch targets of one common condition node. Deeper
    // (transitive) provenance is intentionally not traced — prefer
    // under-warning to a false positive.
    {
      // targetNodeId -> set of condition node ids it is a direct branch of.
      const branchParents = new Map<string, Set<string>>();
      for (const e of flow) {
        const src = byId.get(e.source);
        if (src?.kind === "condition") {
          const set = branchParents.get(e.target) ?? new Set<string>();
          set.add(src.id);
          branchParents.set(e.target, set);
        }
      }
      for (const n of nodes) {
        if (!isOperationKind(n.kind)) continue;
        const isDefaultRule =
          n.triggerRule === undefined || n.triggerRule === "ALL_SUCCESS";
        if (!isDefaultRule) continue;
        const resultEdges = resultDepsOf(n.id);
        if (resultEdges.length <= 1) continue;
        // condition id -> distinct source node ids that are its branch targets.
        const condToSources = new Map<string, Set<string>>();
        for (const e of resultEdges) {
          for (const cid of branchParents.get(e.source) ?? []) {
            const set = condToSources.get(cid) ?? new Set<string>();
            set.add(e.source);
            condToSources.set(cid, set);
          }
        }
        const multi = [...condToSources.values()].some((s) => s.size > 1);
        if (multi) {
          issues.push({
            level: "warning",
            message: `${label(
              n,
            )} is reachable from multiple branches of the same condition; under ALL_SUCCESS it may never run — consider ANY_SUCCESS / NONE_FAILED.`,
            nodeId: n.id,
          });
        }
      }
    }
  }

  return issues;
}
