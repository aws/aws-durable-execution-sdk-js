import { DAR_NODE_KINDS } from "./kinds";
import { TRIGGER_RULES } from "./dag";

/**
 * JSON Schema (draft-07) for the serialized `.dar` workflow. Describes the
 * top-level structure and the shared node/edge/position primitives; node
 * objects allow extra kind-specific fields (`additionalProperties: true`),
 * since each node kind carries its own configuration. Exported for external
 * tooling / editor validation; the packages' `parseWorkflow` remains the
 * authoritative loader.
 */
/**
 * ADVISORY, NOT ENFORCED AT RUNTIME.
 *
 * `parseWorkflow` deliberately checks only the coarse shape (that `nodes` and `edges`
 * are arrays) and does not validate against this schema — no AJV, no validator of any
 * kind runs it. So `additionalProperties: false`, the `required` lists and every `kind`
 * / `triggerRule` enum below describe the intended format for editors, generators and
 * humans; they do NOT reject a document. A node with an unknown `kind` reaches codegen,
 * where the emitter's own `default:` arm is what refuses it.
 *
 * That is a deliberate trade for now — the reader is forgiving on purpose, because
 * `.dar` files arrive hand-written and model-generated — but it means this schema must
 * not be described as authoritative. Wiring validation into `parseWorkflow` is tracked
 * as a follow-up.
 */
export const DAR_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/aws/aws-durable-execution-sdk-js/dar.schema.json",
  title: "Durable Execution visual workflow (.dar)",
  type: "object",
  required: ["nodes"],
  properties: {
    darVersion: { type: "string" },
    name: { type: "string" },
    dependencyMode: { enum: ["linear", "dag"] },
    inputType: { type: "string" },
    dagConfig: { $ref: "#/definitions/dagConfig" },
    nodes: { type: "array", items: { $ref: "#/definitions/node" } },
    edges: { type: "array", items: { $ref: "#/definitions/edge" } },
  },
  definitions: {
    position: {
      type: "object",
      required: ["x", "y"],
      properties: { x: { type: "number" }, y: { type: "number" } },
    },
    node: {
      type: "object",
      required: ["id", "kind", "name"],
      properties: {
        id: { type: "string" },
        kind: { enum: [...DAR_NODE_KINDS] },
        name: { type: "string" },
        position: { $ref: "#/definitions/position" },
        terminal: { type: "boolean" },
        triggerRule: { enum: [...TRIGGER_RULES] },
        runIf: { type: "string" },
      },
      additionalProperties: true,
    },
    edge: {
      type: "object",
      required: ["id", "source", "target"],
      properties: {
        id: { type: "string" },
        source: { type: "string" },
        target: { type: "string" },
        kind: { enum: ["flow", "error"] },
        match: { type: "string" },
        errorType: { type: "string" },
        dependencyKind: { enum: ["result", "ordering"] },
        label: { type: "string" },
      },
      additionalProperties: false,
    },
    /**
     * Workflow-level DAG config (only meaningful in `dag` mode). Kept forgiving:
     * `completionConfig` accepts either the threshold form or the custom
     * `shouldComplete` form (their mutual exclusivity is enforced by
     * validation, not the schema).
     */
    dagConfig: {
      type: "object",
      properties: {
        maxConcurrency: { type: "number" },
        defaultTriggerRule: { enum: [...TRIGGER_RULES] },
        nesting: { enum: ["FLAT", "NESTED"] },
        completionConfig: {
          type: "object",
          properties: {
            minSuccessful: { type: "number" },
            toleratedFailureCount: { type: "number" },
            toleratedFailurePercentage: { type: "number" },
            shouldComplete: { type: "string" },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
  },
} as const;
