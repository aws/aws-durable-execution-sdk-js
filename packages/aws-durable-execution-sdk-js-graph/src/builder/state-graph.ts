import { ChannelMap, END, START, StateOf, StateSchema } from "../schema";
import { NodeFn, RouterFn } from "./node";
import { ConditionalEdge, GraphDef } from "./graph-def";
import { GraphValidationError } from "./errors";

const DEFAULT_MAX_CONCURRENCY = 8;

/**
 * LangGraph-shaped builder for a state graph. Mirrors `addNode`, `addEdge`,
 * `addConditionalEdges`, `START`/`END`, then `compile()` produces the immutable
 * {@link GraphDef} the durable superstep driver runs.
 *
 * Unlike LangGraph, `compile()` does not return a locally-runnable graph — it returns a
 * definition to be driven by {@link runGraph} or wrapped by {@link compileDurable}
 * (design doc §4.2). Construct the graph at module scope, deterministically (brief invariant 5).
 *
 * @typeParam C - The graph's channel map.
 */
export class StateGraph<C extends ChannelMap> {
  private readonly nodes = new Map<string, NodeFn<C>>();
  /** Static (unconditional) edges: source -> list of destinations. */
  private readonly edges = new Map<string, string[]>();
  /** Conditional edges: source -> router + declared ends. */
  private readonly conditional = new Map<string, ConditionalEdge<C>>();

  constructor(
    private readonly schema: StateSchema<C>,
    private readonly name = "graph",
  ) {}

  /**
   * Register a node. Node names are part of the address space (design doc §5.5) — renaming is
   * a breaking change for in-flight executions. Rejects sentinel names and duplicates.
   */
  addNode(name: string, fn: NodeFn<C>): this {
    if (name === START || name === END) {
      throw new GraphValidationError(
        `Node name "${name}" is reserved (START/END sentinel).`,
      );
    }
    if (this.nodes.has(name)) {
      throw new GraphValidationError(`Node "${name}" is already defined.`);
    }
    this.nodes.set(name, fn);
    return this;
  }

  /**
   * Add an unconditional edge `from -> to`. `from` may be {@link START}; `to` may be
   * {@link END}. Multiple edges from the same source fan out in one superstep.
   */
  addEdge(from: string, to: string): this {
    const list = this.edges.get(from) ?? [];
    list.push(to);
    this.edges.set(from, list);
    return this;
  }

  /**
   * Add a conditional edge: a pure router chooses among `ends` based on checkpointed state.
   * `ends` must list every node the router can return (used for static validation), matching
   * LangGraph's third argument. The router MUST be pure (design doc §5.5).
   */
  addConditionalEdges(from: string, router: RouterFn<C>, ends: string[]): this {
    if (this.conditional.has(from)) {
      throw new GraphValidationError(
        `Node "${from}" already has conditional edges.`,
      );
    }
    this.conditional.set(from, { router, ends: [...ends] });
    return this;
  }

  /**
   * Validate the topology and produce the immutable {@link GraphDef}. Throws
   * {@link GraphValidationError} on: unknown node referenced by any edge, a node unreachable
   * from `START`, or a node with no path to `END`.
   */
  compile(): GraphDef<C> {
    this.validateReferences();
    const entry = this.computeEntry();
    this.validateReachableFromStart(entry);
    this.validatePathToEnd();

    const nodesRecord: Record<string, NodeFn<C>> = {};
    for (const [k, v] of this.nodes) {
      nodesRecord[k] = v;
    }

    const orderFrontier = (frontier: string[]): string[] =>
      [...new Set(frontier)].sort();

    const route = (active: string[], state: Readonly<StateOf<C>>): string[] => {
      const next = new Set<string>();
      for (const node of active) {
        for (const dest of this.successors(node, state)) {
          if (dest !== END) {
            next.add(dest);
          }
        }
      }
      return [...next];
    };

    return {
      name: this.name,
      schema: this.schema,
      nodes: nodesRecord,
      entry: orderFrontier(entry),
      maxConcurrency: DEFAULT_MAX_CONCURRENCY,
      orderFrontier,
      route,
    };
  }

  // ---- internal ----------------------------------------------------------

  /** All destinations of `node`: static edges, plus conditional destinations from `state`. */
  private successors(node: string, state: Readonly<StateOf<C>>): string[] {
    const out: string[] = [...(this.edges.get(node) ?? [])];
    const cond = this.conditional.get(node);
    if (cond) {
      const decided = cond.router(state);
      out.push(...(Array.isArray(decided) ? decided : [decided]));
    }
    return out;
  }

  /** Every node name that appears as an edge endpoint (excluding sentinels). */
  private validateReferences(): void {
    const known = (n: string): boolean =>
      n === START || n === END || this.nodes.has(n);

    for (const [from, tos] of this.edges) {
      if (!known(from)) {
        throw new GraphValidationError(`Edge from unknown node "${from}".`);
      }
      for (const to of tos) {
        if (!known(to)) {
          throw new GraphValidationError(
            `Edge "${from}" -> unknown node "${to}".`,
          );
        }
      }
    }
    for (const [from, cond] of this.conditional) {
      if (!known(from)) {
        throw new GraphValidationError(
          `Conditional edge from unknown node "${from}".`,
        );
      }
      for (const to of cond.ends) {
        if (!known(to)) {
          throw new GraphValidationError(
            `Conditional edge "${from}" -> unknown node "${to}".`,
          );
        }
      }
    }
  }

  /** The nodes reachable directly from START via static edges (the initial frontier). */
  private computeEntry(): string[] {
    const entry = (this.edges.get(START) ?? []).filter((n) => n !== END);
    if (entry.length === 0) {
      throw new GraphValidationError(
        `Graph has no entry: add an edge from START to a node.`,
      );
    }
    return entry;
  }

  /**
   * Static reachability: every declared node must be reachable from START following static and
   * declared-conditional (`ends`) edges. Uses declared `ends` rather than executing routers,
   * so validation stays pure and state-independent.
   */
  private validateReachableFromStart(entry: string[]): void {
    const adjacency = this.staticAdjacency();
    const seen = new Set<string>(entry);
    const stack = [...entry];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      for (const next of adjacency.get(cur) ?? []) {
        if (next !== END && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    for (const node of this.nodes.keys()) {
      if (!seen.has(node)) {
        throw new GraphValidationError(
          `Node "${node}" is unreachable from START.`,
        );
      }
    }
  }

  /**
   * Every node must have at least one path to END following static and declared-conditional
   * edges. Computed by reverse reachability from END.
   */
  private validatePathToEnd(): void {
    const adjacency = this.staticAdjacency();
    // Reverse edges.
    const reverse = new Map<string, string[]>();
    for (const [from, tos] of adjacency) {
      for (const to of tos) {
        const list = reverse.get(to) ?? [];
        list.push(from);
        reverse.set(to, list);
      }
    }
    const canReachEnd = new Set<string>([END]);
    const stack = [END];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      for (const pred of reverse.get(cur) ?? []) {
        if (!canReachEnd.has(pred)) {
          canReachEnd.add(pred);
          stack.push(pred);
        }
      }
    }
    for (const node of this.nodes.keys()) {
      if (!canReachEnd.has(node)) {
        throw new GraphValidationError(`Node "${node}" has no path to END.`);
      }
    }
  }

  /**
   * Build a static adjacency map (node -> destinations) using static edges and *declared*
   * conditional `ends`. This is topology-only and independent of runtime state, so it is the
   * right basis for compile-time reachability checks.
   */
  private staticAdjacency(): Map<string, string[]> {
    const adjacency = new Map<string, string[]>();
    const add = (from: string, to: string): void => {
      const list = adjacency.get(from) ?? [];
      list.push(to);
      adjacency.set(from, list);
    };
    for (const [from, tos] of this.edges) {
      for (const to of tos) {
        add(from, to);
      }
    }
    for (const [from, cond] of this.conditional) {
      for (const to of cond.ends) {
        add(from, to);
      }
    }
    return adjacency;
  }
}
