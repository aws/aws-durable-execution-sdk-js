/**
 * Thrown by {@link StateGraph.compile} when the declared topology is invalid: an edge
 * references an unknown node, a node is unreachable from `START`, or a node has no path to
 * `END`. This is a build-time (module-scope) failure, surfaced before any execution begins —
 * consistent with the rule that topology is built at module scope, never from the event
 * payload (brief invariant 5).
 */
export class GraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphValidationError";
    // Restore the prototype chain for instanceof across the TS/ES target boundary.
    Object.setPrototypeOf(this, GraphValidationError.prototype);
  }
}
