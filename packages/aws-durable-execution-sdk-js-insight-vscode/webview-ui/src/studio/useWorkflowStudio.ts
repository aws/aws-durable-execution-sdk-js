/**
 * All Workflow Studio state and mutations, extracted from StudioPage so the
 * page component is a thin composition of the palette/canvas/inspector.
 *
 * Owns: the workflow model, selection, connect mode, zoom, canvas sizing, the
 * confirm/validation dialogs, and every graph mutation (nodes, edges, terminal
 * flags, condition branches), plus drag/drop and auto-layout/fit.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  autoLayout,
  createNode,
  endNodeIdFor,
  insertNodeOnEdgeInWorkflow,
  isLinearWorkflow,
  nearestEdgeId,
  newId,
  nextIndexedName,
  operationNames,
  pruneOrphanEnds,
  starterWorkflow,
  structuralSignature,
  updateWorkflowAtPath,
  validateWorkflow,
  workflowAtPath,
} from "../studioTypes";
import type {
  DarEdge,
  DarNode,
  DarNodeKind,
  DarWorkflow,
} from "../studioTypes";
import {
  KINDS,
  NODE_H,
  NODE_W,
  WORLD_ORIGIN_X,
  WORLD_ORIGIN_Y,
  ZOOM_STEP,
  clampZoom,
} from "./constants";

export interface UseWorkflowStudioOptions {
  /** A workflow loaded from a `.dar` file by the host (null until one opens). */
  loaded: DarWorkflow | null;
  /** Bumped by the host each time a new workflow is loaded, to trigger replace. */
  loadNonce: number;
  /** Ask the host to open a `.dar` file (replaces the canvas). */
  onOpen: () => void;
  /** Ask the host to pick a deployed durable function to edit (replaces the canvas). */
  onEditFunction: () => void;
}

export function useWorkflowStudio({
  loaded,
  loadNonce,
  onOpen,
  onEditFunction,
}: UseWorkflowStudioOptions) {
  const [root, setRoot] = useState<DarWorkflow>(() => starterWorkflow());
  // Baseline for dirty-tracking: the pristine starter or the last-loaded
  // workflow. Every graph mutation replaces the root object, so
  // `root !== baselineRef.current` means the user has made changes.
  const baselineRef = useRef<DarWorkflow>(root);
  // Undo/redo history of whole-`root` snapshots. Every non-history root change
  // pushes the previous root onto the undo stack (and clears redo); undo, redo
  // and load/clear are flagged so they don't record themselves.
  const undoStackRef = useRef<DarWorkflow[]>([]);
  const redoStackRef = useRef<DarWorkflow[]>([]);
  const prevRootRef = useRef<DarWorkflow>(root);
  const historyActionRef = useRef<"edit" | "undo" | "redo" | "reset" | "drag">(
    "edit",
  );
  /** Pre-drag snapshot, pushed on the first real pointer movement. */
  const pendingDragUndoRef = useRef<DarWorkflow | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  // Path of map-node ids from the root to the sub-workflow being edited.
  const [path, setPath] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  // Pending destructive action awaiting confirmation (Clear / Open / Edit
  // function all discard the current canvas).
  const [confirmAction, setConfirmAction] = useState<
    "clear" | "open" | "editFunction" | null
  >(null);
  // Whether the validation details modal is open.
  const [validationOpen, setValidationOpen] = useState(false);
  // Canvas zoom (1 = 100%).
  const [zoom, setZoom] = useState(1);
  // Deferred fit-scroll target + a nonce so `fitTo` can apply the scroll in a
  // layout effect after the zoom re-render (avoids the zoom/scroll flicker).
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  // Session-only "auto-arrange on change" lock (not persisted to the .dar). When
  // true, any STRUCTURAL edit to the active graph (node/connection added or
  // removed) re-runs auto-layout automatically; see the effect below.
  const [layoutLocked, setLayoutLocked] = useState(false);
  // Canvas height, sized to fill the viewport down to the bottom edge.
  const [canvasHeight, setCanvasHeight] = useState(520);
  const canvasRef = useRef<HTMLDivElement>(null);
  /** Wraps whichever view is showing; mounted in all of them (see
   *  `recomputeViewHeight` for why the canvas can't be used for this). */
  const viewAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  // While dragging a "silo" node (no edges) over a link, the edge it would be
  // inserted onto. Ref drives the drop action; state drives the highlight.
  const dropEdgeRef = useRef<string | null>(null);
  const [dropEdgeId, setDropEdgeId] = useState<string | null>(null);

  // Keep the latest path available to the stable setWf below without recreating
  // every mutation callback when the path changes.
  const pathRef = useRef<string[]>([]);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  // The sub-workflow currently being edited (the root when not inside a map).
  const activeWf = useMemo(() => workflowAtPath(root, path), [root, path]);
  // Ref mirror so the pointer-move handler (subscribed once) reads current
  // nodes/edges without re-subscribing on every workflow change.
  const activeWfRef = useRef(activeWf);
  useEffect(() => {
    activeWfRef.current = activeWf;
  }, [activeWf]);
  // Mirror of the layout direction for the once-subscribed pointer handlers /
  // edge-drop callbacks, so insert-on-edge places nodes along the active axis.
  const dirRef = useRef<"TB" | "LR">("TB");
  useEffect(() => {
    dirRef.current = root.layoutDirection ?? "TB";
  }, [root.layoutDirection]);

  // Record history whenever `root` changes. Ordinary edits push the previous
  // root onto the undo stack and clear redo; undo/redo replay silently; a
  // load/clear ("reset") discards history. Guarded by a ref compare so a
  // double-invoked effect (StrictMode) records at most once.
  useEffect(() => {
    if (root === prevRootRef.current) return;
    const action = historyActionRef.current;
    if (action === "edit") {
      undoStackRef.current.push(prevRootRef.current);
      if (undoStackRef.current.length > 100) undoStackRef.current.shift();
      redoStackRef.current = [];
    } else if (action === "reset") {
      undoStackRef.current = [];
      redoStackRef.current = [];
    }
    // "drag" deliberately records nothing here: a drag fires a position update on
    // every pointermove, so one gesture used to push dozens of entries and evict
    // the real history within the 100-entry cap. `startDrag` pushes the single
    // pre-drag state, and the mode is left in place (not reset to "edit") until
    // pointerup so the whole gesture collapses into that one entry.
    if (action !== "drag") historyActionRef.current = "edit";
    prevRootRef.current = root;
    setHistoryVersion((v) => v + 1);
  }, [root]);

  // Scoped workflow setter used by every graph mutation: applies the update to
  // the active sub-workflow within the root. Accepts a value or an updater, like
  // React's setState, so existing mutation code needs no changes.
  const setWf = useCallback(
    (update: DarWorkflow | ((w: DarWorkflow) => DarWorkflow)) => {
      setRoot((r) =>
        updateWorkflowAtPath(r, pathRef.current, (w) =>
          typeof update === "function"
            ? (update as (w: DarWorkflow) => DarWorkflow)(w)
            : update,
        ),
      );
    },
    [],
  );

  // Replace the canvas whenever the host loads a `.dar` file.
  useEffect(() => {
    if (loaded) {
      historyActionRef.current = "reset";
      setRoot(loaded);
      baselineRef.current = loaded;
      setPath([]);
      setSelectedId(null);
      setConnectingFrom(null);
    }
  }, [loadNonce, loaded]);

  /**
   * Replace the whole root workflow (the code view's "apply"). Unlike a file
   * load this is an EDIT: history keeps working (undo returns to the
   * pre-apply graph) and the dirty baseline is left untouched.
   */
  const replaceRoot = useCallback((wf: DarWorkflow) => {
    setRoot(wf);
    setPath([]);
    setSelectedId(null);
    setConnectingFrom(null);
  }, []);

  const selected = useMemo(
    () => activeWf.nodes.find((n) => n.id === selectedId) ?? null,
    [activeWf.nodes, selectedId],
  );

  const updateNode = useCallback((id: string, patch: Partial<DarNode>) => {
    setWf((w) => ({
      ...w,
      nodes: w.nodes.map((n) =>
        n.id === id ? ({ ...n, ...patch } as DarNode) : n,
      ),
    }));
  }, []);

  // Apply content streamed back from an "Edit in VS Code" session. Tokens are
  // `${nodeId}::${field}` or, for a per-branch fallback,
  // `${nodeId}::onErrorFallback::${branchId}`.
  const applyCodeUpdate = useCallback(
    (token: string, content: string) => {
      const parts = token.split("::");
      const nodeId = parts[0];
      if (!nodeId) return;
      if (parts[1] === "onErrorFallback" && parts[2]) {
        const branchId = parts[2];
        setWf((w) => ({
          ...w,
          nodes: w.nodes.map((n) =>
            n.id === nodeId
              ? ({
                  ...n,
                  onError: (n.onError ?? []).map((b) =>
                    b.id === branchId ? { ...b, fallbackCode: content } : b,
                  ),
                } as DarNode)
              : n,
          ),
        }));
        return;
      }
      const field = parts[1];
      if (field) {
        updateNode(nodeId, { [field]: content } as Partial<DarNode>);
      }
    },
    [updateNode, setWf],
  );

  const addNode = useCallback(
    (kind: DarNodeKind, x: number, y: number, integration?: string) => {
      const node = createNode(
        kind,
        {
          x: Math.round(x),
          y: Math.round(y),
        },
        integration,
      );
      setWf((w) => {
        // Give the new node a numbered name (step1, step2, …) unique among ops.
        const named = {
          ...node,
          name: nextIndexedName(node.name, operationNames(w)),
        } as DarNode;
        return { ...w, nodes: [...w.nodes, named] };
      });
      setSelectedId(node.id);
    },
    [],
  );

  /** Insert an `awsSdkCall` node carrying reflected client/command/input. */
  const addAwsSdkCall = useCallback(
    (payload: {
      clientPackage: string;
      clientClass: string;
      command: string;
      input: string;
      name: string;
    }) => {
      const base = createNode("awsSdkCall", { x: 60, y: 60 });
      setWf((w) => {
        const node = {
          ...base,
          clientPackage: payload.clientPackage,
          clientClass: payload.clientClass,
          command: payload.command,
          input: payload.input,
          name: nextIndexedName(payload.name || "sdkCall", operationNames(w)),
        } as DarNode;
        setSelectedId(node.id);
        return { ...w, nodes: [...w.nodes, node] };
      });
    },
    [],
  );

  /**
   * Insert a `httpCall` node prefilled from a vendor's OpenAPI operation.
   * `authEnvVar` is a variable NAME only — see `HttpCallNode`'s doc comment.
   */
  const addHttpCall = useCallback(
    (payload: {
      name: string;
      method: string;
      url: string;
      headers?: string;
      query?: string;
      body?: string;
      authKind?: "none" | "bearer" | "header" | "basic" | "query";
      authEnvVar?: string;
      authName?: string;
      specId?: string;
      operationId?: string;
      comment?: string;
    }) => {
      const base = createNode("httpCall", { x: 60, y: 60 });
      setWf((w) => {
        const node = {
          ...base,
          method: payload.method,
          url: payload.url,
          ...(payload.headers ? { headers: payload.headers } : {}),
          ...(payload.query ? { query: payload.query } : {}),
          ...(payload.body ? { body: payload.body } : {}),
          ...(payload.authKind ? { authKind: payload.authKind } : {}),
          ...(payload.authEnvVar ? { authEnvVar: payload.authEnvVar } : {}),
          ...(payload.authName ? { authName: payload.authName } : {}),
          ...(payload.specId ? { specId: payload.specId } : {}),
          ...(payload.operationId ? { operationId: payload.operationId } : {}),
          ...(payload.comment ? { comment: payload.comment } : {}),
          name: nextIndexedName(payload.name || "apiCall", operationNames(w)),
        } as DarNode;
        setSelectedId(node.id);
        return { ...w, nodes: [...w.nodes, node] };
      });
    },
    [],
  );

  const deleteNode = useCallback((id: string) => {
    // Also drop the end node this node owns (if it was marked terminal), then
    // prune any end left orphaned by the removed edges.
    const endId = endNodeIdFor(id);
    setWf((w) =>
      pruneOrphanEnds({
        ...w,
        nodes: w.nodes.filter((n) => n.id !== id && n.id !== endId),
        edges: w.edges.filter(
          (e) =>
            e.source !== id &&
            e.target !== id &&
            e.source !== endId &&
            e.target !== endId,
        ),
      }),
    );
    setSelectedId((s) => (s === id ? null : s));
  }, []);

  // Toggle a node's terminal flag. When enabled, add an owned `end` node linked
  // from it; when disabled, remove that end node and its edge.
  const setTerminal = useCallback((nodeId: string, terminal: boolean) => {
    setWf((w) => {
      const src = w.nodes.find((n) => n.id === nodeId);
      if (!src) return w;
      const endId = endNodeIdFor(nodeId);
      const nodes = w.nodes.map((n) =>
        n.id === nodeId ? ({ ...n, terminal } as DarNode) : n,
      );
      if (terminal) {
        const withEnd = nodes.some((n) => n.id === endId)
          ? nodes
          : [
              ...nodes,
              {
                id: endId,
                kind: "end",
                name: "end",
                position: {
                  x: src.position.x,
                  y: src.position.y + NODE_H + 60,
                },
              } as DarNode,
            ];
        const edges = w.edges.some(
          (e) => e.source === nodeId && e.target === endId,
        )
          ? w.edges
          : [...w.edges, { id: newId("e"), source: nodeId, target: endId }];
        return { ...w, nodes: withEnd, edges };
      }
      return {
        ...w,
        nodes: nodes.filter((n) => n.id !== endId),
        edges: w.edges.filter((e) => e.source !== endId && e.target !== endId),
      };
    });
  }, []);

  const addEdge = useCallback((source: string, target: string) => {
    if (source === target) return;
    setWf((w) => {
      // End nodes are owned 1:1 by their terminal node and only carry that
      // owner's auto-created edge — block manual connections into an end so a
      // second node can't share (and later be orphaned by) it.
      if (w.nodes.find((n) => n.id === target)?.kind === "end") return w;
      if (w.edges.some((e) => e.source === source && e.target === target))
        return w;

      const sourceWasTerminal = !!w.nodes.find((n) => n.id === source)
        ?.terminal;
      let nodes = w.nodes;
      let edges = w.edges;
      // Connecting a terminal node onward contradicts "end after this node":
      // clear its terminal flag and drop its owned end node + edge.
      if (sourceWasTerminal) {
        const endId = endNodeIdFor(source);
        nodes = nodes
          .filter((n) => n.id !== endId)
          .map((n) =>
            n.id === source ? ({ ...n, terminal: false } as DarNode) : n,
          );
        edges = edges.filter((e) => e.source !== endId && e.target !== endId);
      }

      // Linear (1:1) workflows: a node starts at most one next node, so a new
      // connection replaces the source's existing outgoing edge (re-routing).
      // In "dag" mode multiple outgoing edges are allowed. (Condition branches
      // use addBranch, not addEdge, so they're unaffected; error edges only
      // run on failure, so they don't count as the "next" node.)
      if (isLinearWorkflow(w)) {
        edges = edges.filter((e) => e.source !== source || e.kind === "error");
      }

      edges = [...edges, { id: newId("e"), source, target }];

      // Move the workflow's end forward: if the source was the final node and
      // the new target is otherwise a leaf (no next of its own), make the target
      // the new final node so the workflow keeps an end instead of dead-ending.
      const targetNode = nodes.find((n) => n.id === target);
      const targetIsLeaf = !edges.some(
        (e) => e.source === target && e.kind !== "error",
      );
      if (
        sourceWasTerminal &&
        targetIsLeaf &&
        targetNode &&
        targetNode.kind !== "condition" &&
        targetNode.kind !== "end"
      ) {
        const tEndId = endNodeIdFor(target);
        nodes = nodes.map((n) =>
          n.id === target ? ({ ...n, terminal: true } as DarNode) : n,
        );
        if (!nodes.some((n) => n.id === tEndId)) {
          nodes = [
            ...nodes,
            {
              id: tEndId,
              kind: "end",
              name: "end",
              position: {
                x: targetNode.position.x,
                y: targetNode.position.y + NODE_H + 60,
              },
            } as DarNode,
          ];
        }
        edges = [...edges, { id: newId("e"), source: target, target: tEndId }];
      }

      return { ...w, nodes, edges };
    });
  }, []);

  const deleteEdge = useCallback((id: string) => {
    // Dropping the edge into an owned end would orphan it — prune so no silo
    // end node is left behind.
    setWf((w) =>
      pruneOrphanEnds({ ...w, edges: w.edges.filter((e) => e.id !== id) }),
    );
  }, []);

  // --- condition branches (a condition node's branches are its outgoing edges;
  // the edge `match` is the value to match; a matchless edge is the else branch) ---
  const addBranch = useCallback(
    (source: string, target: string, match: string) => {
      setWf((w) => ({
        ...w,
        edges: [...w.edges, { id: newId("e"), source, target, match }],
      }));
    },
    [],
  );

  // Add an error-route edge: taken when `source` fails with `errorType`
  // (blank = catch-all).
  const addErrorRoute = useCallback(
    (source: string, target: string, errorType: string) => {
      setWf((w) => ({
        ...w,
        edges: [
          ...w.edges,
          { id: newId("e"), source, target, kind: "error", errorType },
        ],
      }));
    },
    [],
  );

  const setBranch = useCallback(
    (
      edgeId: string,
      patch: Partial<Pick<DarEdge, "match" | "target" | "errorType">>,
    ) => {
      // Retargeting a branch away from an end can orphan it — prune to be safe.
      setWf((w) =>
        pruneOrphanEnds({
          ...w,
          edges: w.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)),
        }),
      );
    },
    [],
  );

  // Make a branch terminal: point it at its own `end` node (one end per
  // terminal branch, keyed by the edge id, so multiple terminal branches render
  // as separate ends rather than converging on one).
  const endBranch = useCallback((conditionId: string, edgeId: string) => {
    setWf((w) => {
      const endId = endNodeIdFor(edgeId);
      if (w.nodes.some((n) => n.id === endId)) {
        return {
          ...w,
          edges: w.edges.map((e) =>
            e.id === edgeId ? { ...e, target: endId } : e,
          ),
        };
      }
      const cond = w.nodes.find((n) => n.id === conditionId);
      // Offset each new end so they don't stack before an auto-layout.
      const existingEnds = w.edges.filter((e) => {
        if (e.source !== conditionId) return false;
        return w.nodes.find((n) => n.id === e.target)?.kind === "end";
      }).length;
      const pos = cond
        ? {
            x: cond.position.x + existingEnds * (NODE_W + 30),
            y: cond.position.y + 150,
          }
        : { x: 0, y: 0 };
      return {
        ...w,
        nodes: [
          ...w.nodes,
          { id: endId, kind: "end" as const, name: "end", position: pos },
        ],
        edges: w.edges.map((e) =>
          e.id === edgeId ? { ...e, target: endId } : e,
        ),
      };
    });
  }, []);

  // --- node repositioning (pointer drag on the card header) ---
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      const canvas = canvasRef.current;
      if (!drag || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x =
        (e.clientX - rect.left + canvas.scrollLeft) / zoom -
        WORLD_ORIGIN_X -
        drag.dx;
      const y =
        (e.clientY - rect.top + canvas.scrollTop) / zoom -
        WORLD_ORIGIN_Y -
        drag.dy;
      const nx = Math.round(x);
      const ny = Math.round(y);
      // First actual movement of this gesture: commit the single undo entry
      // stashed at pointer-down, then let the history effect coalesce the rest.
      const pending = pendingDragUndoRef.current;
      if (pending) {
        pendingDragUndoRef.current = null;
        undoStackRef.current.push(pending);
        if (undoStackRef.current.length > 100) undoStackRef.current.shift();
        redoStackRef.current = [];
        historyActionRef.current = "drag";
      }
      updateNode(drag.id, { position: { x: nx, y: ny } });

      // If this node is a "silo" (no edges), light up the link it would drop
      // onto so releasing here inserts it inline.
      const wf = activeWfRef.current;
      const isSilo = !wf.edges.some(
        (ed) => ed.source === drag.id || ed.target === drag.id,
      );
      const hit = isSilo
        ? nearestEdgeId(wf, nx + NODE_W / 2, ny + NODE_H / 2, drag.id)
        : null;
      if (hit !== dropEdgeRef.current) {
        dropEdgeRef.current = hit;
        setDropEdgeId(hit);
      }
    };
    const onUp = () => {
      if (historyActionRef.current === "drag")
        historyActionRef.current = "edit";
      const drag = dragRef.current;
      const edgeId = dropEdgeRef.current;
      dragRef.current = null;
      dropEdgeRef.current = null;
      setDropEdgeId(null);
      if (!drag || !edgeId) return;
      // Rewire A→B into A→node→B with the same minimal layout as a new node.
      setWf((w) => {
        if (
          w.edges.some((ed) => ed.source === drag.id || ed.target === drag.id)
        ) {
          return w; // no longer a silo
        }
        return insertNodeOnEdgeInWorkflow(w, edgeId, drag.id, dirRef.current);
      });
      setSelectedId(drag.id);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateNode, zoom]);

  const startDrag = useCallback(
    (e: React.PointerEvent, node: DarNode) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Stash the pre-drag state; it is only pushed once the pointer actually
      // MOVES (see onMove). startDrag is also the selection path, so pushing
      // here made every plain click on a node record a no-op entry — Ctrl+Z
      // appeared to do nothing, and ordinary clicking still drained the cap.
      pendingDragUndoRef.current = prevRootRef.current;
      const rect = canvas.getBoundingClientRect();
      dragRef.current = {
        id: node.id,
        dx:
          (e.clientX - rect.left + canvas.scrollLeft) / zoom -
          WORLD_ORIGIN_X -
          node.position.x,
        dy:
          (e.clientY - rect.top + canvas.scrollTop) / zoom -
          WORLD_ORIGIN_Y -
          node.position.y,
      };
      setSelectedId(node.id);
    },
    [zoom],
  );

  // Clicking a node while connecting completes the edge; otherwise selects it.
  const onNodeClick = useCallback(
    (id: string) => {
      if (connectingFrom && connectingFrom !== id) {
        addEdge(connectingFrom, id);
        setConnectingFrom(null);
        return;
      }
      setSelectedId(id);
    },
    [connectingFrom, addEdge],
  );

  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const payload = e.dataTransfer.getData("application/dar-node");
      // Job entries encode their integration as `awsJob:<key>`.
      const [rawKind, integration] = payload.split(":");
      const kind = rawKind as DarNodeKind;
      if (kind !== "awsJob" && !KINDS.includes(kind)) return;
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      addNode(
        kind,
        (e.clientX - rect.left + canvas.scrollLeft) / zoom -
          WORLD_ORIGIN_X -
          NODE_W / 2,
        (e.clientY - rect.top + canvas.scrollTop) / zoom -
          WORLD_ORIGIN_Y -
          NODE_H / 2,
        integration || undefined,
      );
    },
    [addNode, zoom],
  );

  // Insert a new node onto an existing edge A→B: place it at the edge midpoint,
  // drop A→B, and wire A→X→B. A condition/branch label stays on the first
  // segment (A→X) so routing is preserved. Keeps linear-mode 1:1 wiring.
  const insertNodeOnEdge = useCallback(
    (edgeId: string, kind: DarNodeKind, integration?: string) => {
      const node = createNode(kind, { x: 0, y: 0 }, integration);
      setWf((w) => {
        const named = {
          ...node,
          name: nextIndexedName(node.name, operationNames(w)),
        } as DarNode;
        return insertNodeOnEdgeInWorkflow(
          { ...w, nodes: [...w.nodes, named] },
          edgeId,
          named.id,
          dirRef.current,
        );
      });
      setSelectedId(node.id);
    },
    [],
  );

  const onEdgeDrop = useCallback(
    (edgeId: string, e: React.DragEvent) => {
      e.preventDefault();
      const payload = e.dataTransfer.getData("application/dar-node");
      const [rawKind, integration] = payload.split(":");
      const kind = rawKind as DarNodeKind;
      if (kind !== "awsJob" && !KINDS.includes(kind)) return;
      insertNodeOnEdge(edgeId, kind, integration || undefined);
    },
    [insertNodeOnEdge],
  );

  // Add a branch to a parallel node (from the node card or the inspector).
  const addParallelBranch = useCallback((nodeId: string) => {
    setWf((w) => ({
      ...w,
      nodes: w.nodes.map((n) =>
        n.id === nodeId && n.kind === "parallel"
          ? {
              ...n,
              branches: [
                ...n.branches,
                {
                  id: newId("b"),
                  name: `branch-${n.branches.length + 1}`,
                  body: starterWorkflow(),
                },
              ],
            }
          : n,
      ),
    }));
  }, []);

  // Remove a branch from a parallel node (keeps at least one).
  const deleteParallelBranch = useCallback(
    (nodeId: string, branchId: string) => {
      setWf((w) => ({
        ...w,
        nodes: w.nodes.map((n) =>
          n.id === nodeId && n.kind === "parallel" && n.branches.length > 1
            ? { ...n, branches: n.branches.filter((b) => b.id !== branchId) }
            : n,
        ),
      }));
    },
    [],
  );

  // Size the view area to fill the space from its top edge to the bottom of the
  // webview, so it occupies the empty vertical area.
  //
  // Measured from `viewAreaRef` — a wrapper that stays mounted in EVERY view —
  // rather than from the canvas, which only exists in the Visual view. Measuring
  // the canvas meant that resizing the window while in Code, Diff or Config
  // found a null ref, bailed out, and left the height frozen at whatever it was
  // when the canvas was last mounted: the view then either fell short of the
  // window or ran off the bottom of it.
  const recomputeViewHeight = useCallback(() => {
    const el = viewAreaRef.current ?? canvasRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    setCanvasHeight(Math.max(360, window.innerHeight - top - 24));
  }, []);

  useEffect(() => {
    recomputeViewHeight();
    window.addEventListener("resize", recomputeViewHeight);
    return () => window.removeEventListener("resize", recomputeViewHeight);
  }, [recomputeViewHeight]);

  const zoomIn = useCallback(
    () => setZoom((z) => clampZoom(z * ZOOM_STEP)),
    [],
  );
  const zoomOut = useCallback(
    () => setZoom((z) => clampZoom(z / ZOOM_STEP)),
    [],
  );
  // Fit the given nodes into the visible canvas (never zooms past 100%) and
  // scroll-center them. Node positions are model-space (centered at (0,0),
  // can be negative); the DOM/world div is a fixed positive-only box offset
  // by WORLD_ORIGIN — converting a model-space point to a scroll target means
  // adding that offset back in.
  const fitTo = useCallback((ns: DarNode[]) => {
    const canvas = canvasRef.current;
    if (!canvas || ns.length === 0) return;
    const minX = Math.min(...ns.map((n) => n.position.x));
    const minY = Math.min(...ns.map((n) => n.position.y));
    const maxX = Math.max(...ns.map((n) => n.position.x + NODE_W));
    const maxY = Math.max(...ns.map((n) => n.position.y + NODE_H));
    const pad = 40;
    const z = clampZoom(
      Math.min(
        canvas.clientWidth / (maxX - minX + 2 * pad),
        canvas.clientHeight / (maxY - minY + 2 * pad),
        1,
      ),
    );
    const centerX = (minX + maxX) / 2 + WORLD_ORIGIN_X;
    const centerY = (minY + maxY) / 2 + WORLD_ORIGIN_Y;
    // Defer the scroll to a layout effect that runs AFTER the zoom re-render
    // commits (so the world div is already at the new zoom): applying it here
    // would scroll against the OLD zoom's layout and then jump when React
    // re-renders — the flicker. Bumping the nonce guarantees the effect fires
    // even when the zoom value is unchanged. Scroll target is computed at the
    // new zoom `z` and applied once, pre-paint (see the useLayoutEffect below).
    pendingScrollRef.current = {
      left: Math.max(0, centerX * z - canvas.clientWidth / 2),
      top: Math.max(0, centerY * z - canvas.clientHeight / 2),
    };
    setZoom(z);
    setFitNonce((n) => n + 1);
  }, []);
  // Apply the pending fit scroll synchronously after the DOM has committed the
  // new zoom (useLayoutEffect runs before paint), so zoom + scroll land in a
  // single visual frame — no intermediate default-zoom/scroll flash. Keyed on
  // `fitNonce` (bumped by every `fitTo`) so it also fires when zoom is unchanged.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const target = pendingScrollRef.current;
    if (canvas && target) {
      canvas.scrollTo(target);
      pendingScrollRef.current = null;
    }
  }, [fitNonce, zoom]);
  /**
   * Frame a freshly laid-out workflow: pick a zoom that fits, then scroll so
   * the graph is centered in the visible canvas. Layout itself centers the
   * graph at model-space (0,0) (see autoLayout), so centering the VIEW is
   * just scrolling to that point — node positions are never rewritten here
   * (unlike the old viewport-size-dependent version, this keeps saved
   * positions independent of whatever window size happened to be open).
   */
  const frameCentered = useCallback(
    (laid: DarWorkflow): DarWorkflow => {
      fitTo(laid.nodes);
      return laid;
    },
    [fitTo],
  );
  const autoFit = useCallback(
    () => fitTo(activeWf.nodes),
    [fitTo, activeWf.nodes],
  );
  // Arrange nodes into an optimal layered layout, then center them in view.
  const handleAutoLayout = useCallback(() => {
    setWf(frameCentered(autoLayout(activeWf, root.layoutDirection ?? "TB")));
  }, [frameCentered, activeWf, root.layoutDirection, setWf]);

  // Toggle the "auto-arrange on change" lock. Turning it ON triggers one
  // arrange immediately (below, via the transition effect) so the graph is
  // tidy the moment the user opts in.
  const toggleLayoutLock = useCallback(() => {
    setLayoutLocked((prev) => !prev);
  }, []);

  // When the lock transitions OFF -> ON, arrange once right away. Kept in an
  // effect (not the toggle callback) so we never call setRoot from inside
  // another component's state updater.
  const prevLockedRef = useRef(false);
  useEffect(() => {
    if (layoutLocked && !prevLockedRef.current) handleAutoLayout();
    prevLockedRef.current = layoutLocked;
  }, [layoutLocked, handleAutoLayout]);

  // Auto-arrange whenever the active graph's STRUCTURE changes while locked.
  // The trigger is a structural signature (sorted node ids + sorted
  // `source>target` connections — see structuralSignature), NOT node
  // positions: dragging a node changes positions but not the signature, and
  // handleAutoLayout only rewrites positions, so a relayout can never change
  // the signature and thus can never re-trigger this effect (no infinite loop).
  //
  // The baseline is re-seeded WITHOUT firing when the lock is off, on the very
  // first observation, or when the active scope itself changes (drilling into /
  // out of a container) — so we relayout only on genuine node/edge edits within
  // the current scope, never on mount, lock-off, selection, or navigation.
  const layoutSigRef = useRef<string | null>(null);
  const layoutSigPathRef = useRef<string>("");
  useEffect(() => {
    const sig = structuralSignature(activeWf);
    const pathKey = path.join("/");
    if (
      !layoutLocked ||
      layoutSigRef.current === null ||
      layoutSigPathRef.current !== pathKey
    ) {
      layoutSigRef.current = sig;
      layoutSigPathRef.current = pathKey;
      return;
    }
    if (layoutSigRef.current !== sig) {
      layoutSigRef.current = sig;
      handleAutoLayout();
    }
  }, [activeWf, layoutLocked, path, handleAutoLayout]);

  // Center the view once on first mount (the starter workflow's small
  // positive coordinates would otherwise sit outside the initial scroll
  // position now that the world div is offset by WORLD_ORIGIN) and again
  // whenever the host loads a `.dar` file (its saved positions could be
  // anywhere in model-space). Auto-layout/direction-switch already frame via
  // frameCentered, so this only needs to cover the two cases that don't.
  const framedOnMountRef = useRef(false);
  useEffect(() => {
    if (!framedOnMountRef.current) {
      framedOnMountRef.current = true;
      autoFit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (loaded) autoFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadNonce]);

  // Current canvas layout direction (persisted on the root workflow).
  const layoutDirection = root.layoutDirection ?? "TB";
  // Switch layout direction: persist it on the root and re-arrange + frame the
  // currently-active sub-workflow in the new direction.
  const setLayoutDirection = useCallback(
    (dir: "TB" | "LR") => {
      const framed = frameCentered(autoLayout(activeWf, dir));
      setRoot((r) => {
        const relaid = updateWorkflowAtPath(r, pathRef.current, () => framed);
        return { ...relaid, layoutDirection: dir };
      });
    },
    [activeWf, frameCentered],
  );

  const byId = useMemo(() => {
    const m = new Map<string, DarNode>();
    activeWf.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [activeWf.nodes]);

  // Live structural validation — recomputed on every edit.
  const issues = useMemo(() => validateWorkflow(activeWf), [activeWf]);
  const hasErrors = issues.some((i) => i.level === "error");
  // Ids of nodes implicated by an error (for red borders / red edges).
  const errorNodeIds = useMemo(() => {
    const s = new Set<string>();
    for (const issue of issues) {
      if (issue.level !== "error") continue;
      if (issue.nodeId) s.add(issue.nodeId);
      issue.nodeIds?.forEach((id) => s.add(id));
    }
    return s;
  }, [issues]);

  const renameWorkflow = useCallback(
    (name: string) => setWf((w) => ({ ...w, name })),
    [],
  );

  // Execution input type is a root-only property.
  const setInputType = useCallback(
    (inputType: string) => setRoot((r) => ({ ...r, inputType })),
    [],
  );

  /** The workflow-level description, emitted as a comment above the handler. */
  const setWorkflowComment = useCallback(
    (comment: string) =>
      setWf((w) => ({ ...w, comment: comment === "" ? undefined : comment })),
    [],
  );

  const clearNow = useCallback(() => {
    const fresh = starterWorkflow();
    historyActionRef.current = "reset";
    setRoot(fresh);
    baselineRef.current = fresh;
    setPath([]);
    setSelectedId(null);
    setConnectingFrom(null);
  }, []);

  // --- undo / redo (whole-root snapshots) ---
  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop() as DarWorkflow;
    redoStackRef.current.push(prevRootRef.current);
    historyActionRef.current = "undo";
    setSelectedId(null);
    setConnectingFrom(null);
    setRoot(prev);
  }, []);
  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop() as DarWorkflow;
    undoStackRef.current.push(prevRootRef.current);
    historyActionRef.current = "redo";
    setSelectedId(null);
    setConnectingFrom(null);
    setRoot(next);
  }, []);
  // `historyVersion` is read only to re-derive these on each history change.
  void historyVersion;
  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;
  // Clear / Open / Edit function all discard the current canvas — confirm
  // first, but only when the user has actually made changes (a pristine starter
  // or freshly-loaded workflow has nothing to lose).
  const dirty = root !== baselineRef.current;
  /** The last committed (loaded/saved/deployed) root — the diff-view base. */
  const getBaseline = useCallback(() => baselineRef.current, []);
  /** Mark a workflow as committed (after a successful save/deploy). Pass the
   *  exact snapshot that was saved/deployed — edits made while the async ack
   *  was in flight must stay "dirty". */
  const markCommitted = useCallback(
    (wf?: DarWorkflow) => {
      baselineRef.current = wf ?? root;
    },
    [root],
  );
  const requestClear = useCallback(
    () => (dirty ? setConfirmAction("clear") : clearNow()),
    [dirty, clearNow],
  );
  const requestOpen = useCallback(
    () => (dirty ? setConfirmAction("open") : onOpen()),
    [dirty, onOpen],
  );
  const requestEditFunction = useCallback(
    () => (dirty ? setConfirmAction("editFunction") : onEditFunction()),
    [dirty, onEditFunction],
  );
  const confirmProceed = useCallback(() => {
    if (confirmAction === "clear") clearNow();
    else if (confirmAction === "open") onOpen();
    else if (confirmAction === "editFunction") onEditFunction();
    setConfirmAction(null);
  }, [confirmAction, clearNow, onOpen, onEditFunction]);

  // --- drill-in navigation into / out of container (map/group) bodies ---
  const enterContainer = useCallback((containerId: string) => {
    setPath((p) => [...p, containerId]);
    setSelectedId(null);
    setConnectingFrom(null);
  }, []);
  const exitTo = useCallback((depth: number) => {
    setPath((p) => p.slice(0, depth));
    setSelectedId(null);
    setConnectingFrom(null);
  }, []);

  return {
    // state + refs
    wf: activeWf,
    rootWf: root,
    path,
    selected,
    selectedId,
    connectingFrom,
    confirmAction,
    validationOpen,
    zoom,
    canvasHeight,
    canvasRef,
    viewAreaRef,
    recomputeViewHeight,
    dropEdgeId,
    // derived
    byId,
    issues,
    hasErrors,
    errorNodeIds,
    // setters exposed to the view
    setSelectedId,
    setConnectingFrom,
    setValidationOpen,
    setConfirmAction,
    renameWorkflow,
    setInputType,
    setWorkflowComment,
    replaceRoot,
    getBaseline,
    markCommitted,
    // mutations
    addNode,
    addAwsSdkCall,
    addHttpCall,
    updateNode,
    applyCodeUpdate,
    addParallelBranch,
    deleteParallelBranch,
    deleteNode,
    setTerminal,
    deleteEdge,
    addBranch,
    addErrorRoute,
    setBranch,
    endBranch,
    // canvas interactions
    startDrag,
    onNodeClick,
    onCanvasDrop,
    onEdgeDrop,
    zoomIn,
    zoomOut,
    autoFit,
    handleAutoLayout,
    layoutLocked,
    toggleLayoutLock,
    layoutDirection,
    setLayoutDirection,
    undo,
    redo,
    canUndo,
    canRedo,
    // toolbar actions
    requestClear,
    requestOpen,
    requestEditFunction,
    confirmProceed,
    // navigation
    enterContainer,
    exitTo,
  };
}
