import type {
  DurableContext,
  DurableLogger,
} from "@aws/durable-execution-sdk-js";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import { microvm, microvmSession } from "..";
import { baseConfig, FakeMicrovmsClient } from "./fakes";

// The operations take a DurableContext with the default logger type. A
// handler can configure its own logger type, and its context then has that
// type. These calls must still compile. They compile because DurableContext
// uses the logger type in method parameters, which TypeScript checks
// bivariantly, and in the `logger` property, which TypeScript checks
// covariantly. So a context with a richer logger is assignable to the default
// one. A change
// that makes DurableContext invariant in its logger type would break every
// caller with a custom logger. `npm test` runs tsc first, so this file fails
// the build in that case. The test body only checks that the calls are
// functions; it never runs a durable execution.

interface AuditLogger extends DurableLogger {
  audit(message: string): void;
}

describe("operations with a custom-logger context", () => {
  it("accept a context whose logger type extends DurableLogger", () => {
    const config = baseConfig(new FakeMicrovmsClient());
    const handler = withDurableExecution<unknown, unknown, AuditLogger>(
      async (_event, ctx: DurableContext<AuditLogger>) => {
        await microvm(ctx, "one", { repo: "a" }, config);
        await ctx.map("items", [1, 2], (itemCtx, n) =>
          microvm(itemCtx, `item-${n}`, n, config),
        );
        return microvmSession(ctx, "session", config, async (vm, ctx) =>
          vm.invoke(ctx, "job", 1, { timeout: { minutes: 1 } }),
        );
      },
    );

    expect(typeof handler).toBe("function");
  });
});
