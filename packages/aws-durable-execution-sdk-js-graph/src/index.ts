/**
 * `@aws/durable-execution-sdk-js-graph` — a LangGraph-shaped agent graph runtime whose engine
 * is the AWS Lambda durable-functions SDK instead of LangGraph's Pregel/BSP runtime and
 * database checkpointer.
 *
 * Phase 1 POC (design doc §14). Uses POSITIONAL operation ids (the §6 fallback) with the graph
 * structural path encoded in the operation `Name`, because `createStepId` is private in core
 * SDK v2.3.0 and the POC must not modify core. See POC_FINDINGS.md for what this costs and what
 * an `operationIdProvider` seam would need.
 */

// Primary entry point + the thin handler wrapper.
export { runGraph } from "./runtime/run-graph";
export { compileDurable } from "./runtime/compile-durable";
export type { GraphHandlerEvent } from "./runtime/compile-durable";

// Builder surface.
export { StateGraph, GraphValidationError } from "./builder";
export type {
  GraphDef,
  ConditionalEdge,
  NodeFn,
  RouterFn,
  NodeContext,
} from "./builder";

// State schema: channels + reducers + sentinels.
export {
  lastValue,
  appendValue,
  messagesValue,
  StateSchema,
  START,
  END,
} from "./schema";
export type { Channel, ChannelMap, StateOf, DeltaOf, Sentinel } from "./schema";

// Interrupt (human-in-the-loop via waitForCallback).
export { interrupt } from "./interrupt";
export type { InterruptConfig } from "./interrupt/interrupt";

// Drift detection.
export { GraphDriftError } from "./runtime/errors";
export { assertFrontierMatchesRecord } from "./runtime/frontier-attestation";

// Structural-path helpers (identity, §6 fallback).
export { tickPath, nodePath, localPath, hashPath } from "./identity";
