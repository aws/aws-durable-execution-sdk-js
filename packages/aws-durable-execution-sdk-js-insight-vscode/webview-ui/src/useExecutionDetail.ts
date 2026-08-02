/**
 * Execution Detail state and mutations, extracted from App so the top-level
 * component doesn't own every feature's state directly.
 *
 * Owns: the "start execution" in-flight state (starting/startError, shared by
 * both the function-detail "Start execution" modal and the execution-detail
 * "Start new execution" button), the currently-viewed execution's detail
 * (+ loading/error), its embedded workflow (+ the ref tracking which arn's
 * workflow we've already fetched, so polling doesn't re-download the
 * unchanging code package), and the polling effect that refreshes a
 * non-terminal execution's detail every few seconds while it's being viewed.
 *
 * `view` is needed only to gate the polling effect (App owns top-level view
 * routing); `setView` is needed because starting an execution or opening one
 * navigates to the executionDetail view — both are passed in from the caller,
 * mirroring how useWorkflowStudio takes onOpen/onEditFunction callbacks.
 */
import { useEffect, useRef, useState } from "react";
import { postMessage } from "./vscode";
import { parseWorkflow } from "./studioTypes";
import type { DarWorkflow } from "./studioTypes";
import type { ExecutionDetail } from "./types";
import type { ViewType } from "./useDurableFunctionsView";

export interface UseExecutionDetailOptions {
  /** Top-level view, owned by App (used by the polling effect's condition). */
  view: ViewType;
  /** Top-level view setter, owned by App (used by startExecutionFor/openExecution). */
  setView: (v: ViewType) => void;
}

export function useExecutionDetail({
  view,
  setView,
}: UseExecutionDetailOptions) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [executionDetail, setExecutionDetail] =
    useState<ExecutionDetail | null>(null);
  const [executionDetailError, setExecutionDetailError] = useState("");
  const [executionDetailLoading, setExecutionDetailLoading] = useState(false);
  const [selectedExecutionArn, setSelectedExecutionArn] = useState<
    string | null
  >(null);
  const [executionWorkflow, setExecutionWorkflow] =
    useState<DarWorkflow | null>(null);
  // Which execution arn we've already fetched the embedded workflow for, so the
  // auto-refresh poll doesn't re-download the (unchanging) code package.
  const workflowFetchedArnRef = useRef<string | null>(null);

  // Start a new execution of a specific function (used by the execution-detail
  // "Start new execution" button, which reuses the previous input).
  const startExecutionFor = (
    functionName: string,
    payload: string,
    executionName?: string,
  ) => {
    setStarting(true);
    setStartError("");
    postMessage({
      type: "startExecution",
      functionName,
      payload,
      executionName,
    });
  };

  const openExecution = (arn: string) => {
    setSelectedExecutionArn(arn);
    workflowFetchedArnRef.current = null;
    setExecutionDetail(null);
    setExecutionWorkflow(null);
    setExecutionDetailError("");
    setExecutionDetailLoading(true);
    setView("executionDetail");
    postMessage({ type: "getExecution", arn });
  };

  const refreshExecutionDetail = () => {
    if (!selectedExecutionArn) return;
    setExecutionDetailLoading(true);
    postMessage({ type: "getExecution", arn: selectedExecutionArn });
  };

  const handleStopExecution = (arn: string) => {
    postMessage({ type: "stopExecution", arn });
  };

  // While viewing a still-running execution, silently poll for fresh detail /
  // history / operations until it reaches a terminal status.
  const detailStatus = executionDetail?.status;
  useEffect(() => {
    if (view !== "executionDetail" || !selectedExecutionArn || !detailStatus) {
      return;
    }
    const TERMINAL = [
      "SUCCEEDED",
      "FAILED",
      "TIMED_OUT",
      "STOPPED",
      "CANCELLED",
    ];
    if (TERMINAL.includes(detailStatus)) return;
    const id = setInterval(() => {
      postMessage({ type: "getExecution", arn: selectedExecutionArn });
    }, 4000);
    return () => clearInterval(id);
  }, [view, selectedExecutionArn, detailStatus]);

  // --- apply* methods for the corresponding handleMessage switch cases ---

  /** Mirrors the executionStarted-triggered fields of case "executionStarted". */
  const applyExecutionStarted = (
    durableExecutionArn?: string,
    error?: string,
  ) => {
    setStarting(false);
    if (error) {
      setStartError(error);
    } else if (durableExecutionArn) {
      setStartError("");
      setSelectedExecutionArn(durableExecutionArn);
      setExecutionDetail(null);
      setExecutionDetailError("");
      setExecutionDetailLoading(true);
      setView("executionDetail");
      postMessage({ type: "getExecution", arn: durableExecutionArn });
    } else {
      setStartError("Invoke returned no execution ARN.");
    }
  };

  /** Mirrors case "executionDetail". */
  const applyExecutionDetail = (
    detail: ExecutionDetail | null,
    error?: string,
  ) => {
    setExecutionDetail(detail);
    setExecutionDetailError(error ?? "");
    setExecutionDetailLoading(false);
    if (detail?.functionArn && workflowFetchedArnRef.current !== detail.arn) {
      workflowFetchedArnRef.current = detail.arn;
      postMessage({
        type: "getExecutionWorkflow",
        arn: detail.arn,
        functionArn: detail.functionArn,
      });
    }
  };

  /** Mirrors case "executionWorkflow". */
  const applyExecutionWorkflow = (dar?: string) => {
    try {
      setExecutionWorkflow(dar ? parseWorkflow(JSON.parse(dar)) : null);
    } catch {
      setExecutionWorkflow(null);
    }
  };

  return {
    // state
    starting,
    startError,
    executionDetail,
    executionDetailError,
    executionDetailLoading,
    selectedExecutionArn,
    executionWorkflow,
    // mutations
    startExecutionFor,
    openExecution,
    refreshExecutionDetail,
    handleStopExecution,
    // message-handler helpers
    applyExecutionStarted,
    applyExecutionDetail,
    applyExecutionWorkflow,
  };
}
