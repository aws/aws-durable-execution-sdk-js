/**
 * State and actions for the execution viewer (functions → function →
 * execution), kept out of App so App only routes.
 *
 * Replies from the host name what they answer (function name / execution ARN).
 * A reply for something the user has since navigated away from is dropped, so
 * a slow response can never overwrite the page now showing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { postMessage } from "./hostBridge";
import {
  functionNameFromExecutionArn,
  isTerminal,
  regionFromExecutionArn,
} from "./executionFormat";
import type {
  ExecutionDetail,
  ExecutionRow,
  ExecutionViewerMessage,
  FunctionInfo,
  FunctionSummary,
} from "./types";

export type ViewerPage = "functions" | "function" | "execution";

/** How often a still-running execution is re-fetched while it is on screen. */
const POLL_MS = 4000;

const VIEWER_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "functionsList",
  "functionInfo",
  "executionsList",
  "executionDetail",
]);

export function isExecutionViewerMessage(msg: {
  type: string;
}): msg is ExecutionViewerMessage {
  return VIEWER_MESSAGE_TYPES.has(msg.type);
}

export function useExecutionViewer(active: boolean) {
  const [page, setPage] = useState<ViewerPage>("functions");

  const [functions, setFunctions] = useState<FunctionSummary[]>([]);
  const [functionsLoading, setFunctionsLoading] = useState(false);
  const [functionsError, setFunctionsError] = useState("");
  const functionsRequested = useRef(false);

  const [fnName, setFnName] = useState<string | null>(null);
  const fnNameRef = useRef<string | null>(null);
  const fnRegionRef = useRef<string | undefined>(undefined);
  const [fnInfo, setFnInfo] = useState<FunctionInfo | null>(null);
  const [fnInfoError, setFnInfoError] = useState("");
  const [executions, setExecutions] = useState<ExecutionRow[]>([]);
  const [execMarker, setExecMarker] = useState<string | undefined>();
  const [execLoading, setExecLoading] = useState(false);
  const [execError, setExecError] = useState("");

  const [arn, setArn] = useState<string | null>(null);
  const arnRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const inFlight = useRef(false);
  const loadFunctions = useCallback(() => {
    functionsRequested.current = true;
    setFunctionsLoading(true);
    setFunctionsError("");
    postMessage({ type: "listFunctions" });
  }, []);

  // Load the list the first time the viewer is shown, not at startup.
  useEffect(() => {
    if (active && !functionsRequested.current) loadFunctions();
  }, [active, loadFunctions]);

  const fetchExecutions = (name: string, marker?: string) => {
    setExecLoading(true);
    postMessage({
      type: "listExecutions",
      functionName: name,
      marker,
      region: fnRegionRef.current,
    });
  };

  /**
   * Opens a function's page. `region` is set when the function was reached
   * from an execution in another region; functions picked from the list are
   * in the configured region.
   */
  const openFunction = (name: string, region?: string) => {
    fnNameRef.current = name;
    fnRegionRef.current = region;
    setFnName(name);
    setFnInfo(null);
    setFnInfoError("");
    setExecutions([]);
    setExecMarker(undefined);
    setExecError("");
    setPage("function");
    postMessage({ type: "getFunctionInfo", functionName: name, region });
    fetchExecutions(name);
  };

  const fetchDetail = useCallback((target: string, showLoading: boolean) => {
    inFlight.current = true;
    if (showLoading) setDetailLoading(true);
    postMessage({ type: "getExecution", arn: target });
  }, []);

  const openExecution = (target: string) => {
    arnRef.current = target;
    setArn(target);
    setDetail(null);
    setDetailError("");
    setPage("execution");
    // Keep the breadcrumb meaningful when the execution was opened from a
    // query result rather than from its function's page.
    const owner = functionNameFromExecutionArn(target);
    const ownerRegion = regionFromExecutionArn(target);
    if (
      owner &&
      (owner !== fnNameRef.current || ownerRegion !== fnRegionRef.current)
    ) {
      fnNameRef.current = owner;
      fnRegionRef.current = ownerRegion;
      setFnName(owner);
      setFnInfo(null);
      setExecutions([]);
      setExecMarker(undefined);
      // A list request for the previous function may still be out; its reply
      // will be dropped, so clear its loading state or this page never loads.
      setExecLoading(false);
      setExecError("");
    }
    fetchDetail(target, true);
  };

  const status = detail?.status;
  useEffect(() => {
    if (!active || page !== "execution" || !arn || !status) return;
    if (isTerminal(status)) return;
    const id = setInterval(() => {
      // Skip a tick rather than stack requests behind a slow one.
      if (!inFlight.current) fetchDetail(arn, false);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [active, page, arn, status, fetchDetail]);

  const goTo = (target: ViewerPage) => {
    if (target === "function" && fnNameRef.current) {
      // Arriving here from an execution opened elsewhere: load the page.
      if (executions.length === 0 && !execLoading) {
        openFunction(fnNameRef.current, fnRegionRef.current);
        return;
      }
    }
    if (target === "functions" && !functionsRequested.current) loadFunctions();
    setPage(target);
  };

  /** Applies a host reply; replies for a page no longer showing are dropped. */
  const apply = (msg: ExecutionViewerMessage): void => {
    switch (msg.type) {
      case "functionsList":
        setFunctions(msg.functions);
        setFunctionsLoading(msg.loading);
        setFunctionsError(msg.error ?? "");
        return;
      case "functionInfo":
        if (msg.functionName !== fnNameRef.current) return;
        setFnInfo(msg.info ?? null);
        setFnInfoError(msg.error ?? "");
        return;
      case "executionsList":
        if (msg.functionName !== fnNameRef.current) return;
        setExecLoading(false);
        setExecError(msg.error ?? "");
        setExecMarker(msg.nextMarker);
        setExecutions((prev) =>
          msg.append ? [...prev, ...msg.executions] : msg.executions,
        );
        return;
      case "executionDetail":
        if (msg.arn !== arnRef.current) return;
        inFlight.current = false;
        setDetailLoading(false);
        if (msg.detail) setDetail(msg.detail);
        setDetailError(msg.error ?? "");
        return;
    }
  };

  return {
    page,
    goTo,
    functions,
    functionsLoading,
    functionsError,
    loadFunctions,
    fnName,
    fnInfo,
    fnInfoError,
    executions,
    hasMoreExecutions: execMarker !== undefined,
    execLoading,
    execError,
    openFunction,
    refreshExecutions: () => {
      if (!fnNameRef.current) return;
      setExecMarker(undefined);
      fetchExecutions(fnNameRef.current);
    },
    loadMoreExecutions: () => {
      if (fnNameRef.current && execMarker) {
        fetchExecutions(fnNameRef.current, execMarker);
      }
    },
    arn,
    detail,
    detailError,
    detailLoading,
    openExecution,
    refreshDetail: () => arn && fetchDetail(arn, true),
    apply,
  };
}
