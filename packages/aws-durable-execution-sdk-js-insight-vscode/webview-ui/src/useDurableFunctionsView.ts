/**
 * Durable Functions list/detail state and mutations, extracted from App so the
 * top-level component doesn't own every feature's state directly.
 *
 * Owns: the functions list (+ loading/error), the currently selected function
 * and its info, and that function's executions page (+ pagination marker and
 * the "am I appending vs. replacing" ref), plus every mutation that drives
 * those (refresh/select/load-more/refresh-executions) and the one navigation
 * helper (handleViewFunction) that also needs to flip the top-level view.
 *
 * `setView` is owned by App itself (top-level view routing) and passed in here
 * only so handleViewFunction can jump to the function-detail view, mirroring
 * how useWorkflowStudio takes onOpen/onEditFunction callbacks from its caller.
 */
import { useRef, useState } from "react";
import { postMessage } from "./vscode";
import type { ExecutionRow, FunctionInfo, FunctionSummary } from "./types";

export type ViewType =
  | "explorer"
  | "studio"
  | "functions"
  | "functionDetail"
  | "executionDetail";

export interface UseDurableFunctionsViewOptions {
  /** Top-level view setter, owned by App (used by handleViewFunction). */
  setView: (v: ViewType) => void;
}

export function useDurableFunctionsView({
  setView,
}: UseDurableFunctionsViewOptions) {
  const [functionsList, setFunctionsList] = useState<FunctionSummary[]>([]);
  const [functionsError, setFunctionsError] = useState("");
  const [functionsLoading, setFunctionsLoading] = useState(false);
  const [selectedFn, setSelectedFn] = useState<string | null>(null);
  const [fnInfo, setFnInfo] = useState<FunctionInfo | null>(null);
  const [fnInfoError, setFnInfoError] = useState("");
  const [executions, setExecutions] = useState<ExecutionRow[]>([]);
  const [execError, setExecError] = useState("");
  const [execNextMarker, setExecNextMarker] = useState<string | undefined>();
  const [execLoading, setExecLoading] = useState(false);
  const execAppendRef = useRef(false);

  const refreshFunctions = () => {
    setFunctionsError("");
    setFunctionsLoading(true);
    postMessage({ type: "listFunctions" });
  };

  const selectFunction = (name: string) => {
    setSelectedFn(name);
    setFnInfo(null);
    setFnInfoError("");
    setExecutions([]);
    setExecError("");
    setExecNextMarker(undefined);
    execAppendRef.current = false;
    setExecLoading(true);
    postMessage({ type: "getFunctionInfo", functionName: name });
    postMessage({ type: "listExecutions", functionName: name });
  };

  const loadMoreExecutions = () => {
    if (!selectedFn || !execNextMarker) return;
    execAppendRef.current = true;
    setExecLoading(true);
    postMessage({
      type: "listExecutions",
      functionName: selectedFn,
      marker: execNextMarker,
    });
  };

  const refreshExecutions = () => {
    if (!selectedFn) return;
    setExecutions([]);
    setExecError("");
    setExecNextMarker(undefined);
    execAppendRef.current = false;
    setExecLoading(true);
    postMessage({ type: "listExecutions", functionName: selectedFn });
  };

  // Jump to the Durable Functions view focused on a specific function (used
  // after a deploy succeeds).
  const handleViewFunction = (name: string) => {
    setView("functionDetail");
    refreshFunctions();
    selectFunction(name);
  };

  // --- apply* methods for the corresponding handleMessage switch cases ---

  /** Mirrors case "functionsList". */
  const applyFunctionsList = (
    functions: FunctionSummary[],
    error?: string,
    loading?: boolean,
  ) => {
    setFunctionsList(functions);
    setFunctionsError(error ?? "");
    setFunctionsLoading(loading ?? false);
  };

  /** Mirrors case "functionInfo". */
  const applyFunctionInfo = (info: FunctionInfo | null, error?: string) => {
    setFnInfo(info);
    setFnInfoError(error ?? "");
  };

  /** Mirrors case "executionsList". */
  const applyExecutionsList = (
    executionsMsg: ExecutionRow[],
    error?: string,
    nextMarker?: string,
  ) => {
    setExecError(error ?? "");
    setExecNextMarker(nextMarker);
    setExecutions((prev) =>
      execAppendRef.current ? [...prev, ...executionsMsg] : executionsMsg,
    );
    setExecLoading(false);
  };

  return {
    // state
    functionsList,
    functionsError,
    functionsLoading,
    selectedFn,
    fnInfo,
    fnInfoError,
    executions,
    execError,
    execNextMarker,
    execLoading,
    // mutations
    refreshFunctions,
    selectFunction,
    loadMoreExecutions,
    refreshExecutions,
    handleViewFunction,
    // message-handler helpers
    applyFunctionsList,
    applyFunctionInfo,
    applyExecutionsList,
  };
}
