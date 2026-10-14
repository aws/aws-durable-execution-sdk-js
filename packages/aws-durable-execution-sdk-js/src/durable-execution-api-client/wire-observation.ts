// Temporary diagnostic branch only. Never merge this observation into a release.
import type { LambdaClient } from "@aws-sdk/client-lambda";

interface ObservedUpdate {
  Id?: string;
  Name?: string;
  Type?: string;
  Action?: string;
  ChainedInvokeOptions?: { XAmznTraceId?: unknown };
}

function header(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Observe the real serialized request without changing it or invoking a hook. */
export function attachWireObservation(client: LambdaClient): void {
  client.middlewareStack.add(
    (next, context) => async (args) => {
      if (context.commandName === "CheckpointDurableExecutionCommand") {
        try {
          const input = args.input as {
            DurableExecutionArn?: string;
            Updates?: ObservedUpdate[];
          };
          const request = args.request as { body?: unknown };
          const raw = request.body;
          if (typeof raw === "string" || raw instanceof Uint8Array) {
            const body = JSON.parse(
              typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"),
            ) as { Updates?: ObservedUpdate[] };
            for (const [index, update] of (input.Updates ?? []).entries()) {
              if (update.Type !== "CHAINED_INVOKE" || update.Action !== "START")
                continue;
              const wire = body.Updates?.[index];
              // Deliberately exclude payloads, checkpoint/client tokens and HTTP
              // headers. Preserve DTO/wire absence and operation-index mismatches.
              console.info(
                "CHAIN_WIRE_OBSERVATION " +
                  JSON.stringify({
                    executionArn: input.DurableExecutionArn,
                    operationId: update.Id,
                    operationName: update.Name,
                    updateIndex: index,
                    wireOperationId: wire?.Id ?? null,
                    dtoHeader: header(
                      update.ChainedInvokeOptions?.XAmznTraceId,
                    ),
                    wireHeader: header(
                      wire?.ChainedInvokeOptions?.XAmznTraceId,
                    ),
                  }),
              );
            }
          }
        } catch {
          // Observation must not alter checkpoint delivery or error semantics.
          console.info("CHAIN_WIRE_OBSERVATION_UNAVAILABLE");
        }
      }
      return next(args);
    },
    {
      name: "temporaryDurableWireObservation",
      step: "deserialize",
      priority: "high",
    },
  );
}
