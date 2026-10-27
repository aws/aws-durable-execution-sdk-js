import type { Tracer } from "@opentelemetry/api";
import type { IdGenerator } from "@opentelemetry/sdk-trace-node";
import { DeterministicIdGenerator } from "./deterministic-id-generator";

const ID_GENERATOR_FIELD = "_idGenerator";

function isIdGenerator(value: unknown): value is IdGenerator {
  return (
    typeof value === "object" &&
    value !== null &&
    "generateTraceId" in value &&
    typeof value.generateTraceId === "function" &&
    "generateSpanId" in value &&
    typeof value.generateSpanId === "function"
  );
}

/**
 * Installs deterministic durable IDs on an OpenTelemetry SDK tracer while
 * preserving its configured generator for all unscoped ID generation.
 *
 * OpenTelemetry JavaScript does not expose this generator through its public
 * API. SDK tracers have historically stored it in the TypeScript-private
 * `_idGenerator` field, which remains writable at runtime.
 */
export function tryInstallGlobalIdGenerator(
  tracer: Tracer,
): DeterministicIdGenerator | undefined {
  try {
    const existingIdGenerator = Reflect.get(tracer, ID_GENERATOR_FIELD);
    if (!isIdGenerator(existingIdGenerator)) {
      return undefined;
    }
    if (existingIdGenerator instanceof DeterministicIdGenerator) {
      return existingIdGenerator;
    }

    const deterministicIdGenerator = new DeterministicIdGenerator(
      existingIdGenerator,
    );
    if (
      !Reflect.set(tracer, ID_GENERATOR_FIELD, deterministicIdGenerator) ||
      Reflect.get(tracer, ID_GENERATOR_FIELD) !== deterministicIdGenerator
    ) {
      return undefined;
    }
    return deterministicIdGenerator;
  } catch {
    return undefined;
  }
}
