/**
 * Barrel for the Workflow Studio data model. The implementation is split into
 * focused modules under `studioModel/`; this re-exports them so existing
 * `./studioTypes` imports keep working:
 *   - strategy      — retry/wait strategy spec, defaults, normalization
 *   - model         — node/edge/workflow types, createNode, parseWorkflow, helpers
 *   - validation    — validateWorkflow + ValidationIssue
 *   - layout        — autoLayout
 *   - edgeGeometry  — nearestEdgeId, insertNodeOnEdgeInWorkflow, pointSegDist
 */
export * from "./studioModel/strategy";
export * from "./studioModel/model";
export * from "./studioModel/validation";
export * from "./studioModel/layout";
export * from "./studioModel/edgeGeometry";
