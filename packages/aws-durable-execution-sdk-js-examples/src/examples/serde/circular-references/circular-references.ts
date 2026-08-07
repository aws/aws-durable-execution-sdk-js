import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Circular-Safe Error Logging",
  description:
    "When verbose logging is enabled, the SDK stringifies logged values with a " +
    "circular-reference-safe serializer. This example throws errors whose object " +
    "graphs are hostile to plain JSON.stringify — a self-referential/shared-reference " +
    "graph and a BigInt-carrying error — to show that logging degrades gracefully " +
    "('[Circular]', '[Unable to stringify]') instead of crashing the invocation.",
  // localOnly: the safe stringifier only runs in verbose mode, but the generated
  // SAM template hardcodes DURABLE_VERBOSE_MODE:"false" for every function and
  // ExampleConfig has no per-example env override, so a cloud deployment could
  // not exercise this path. The test enables verbose mode in-process (see the
  // test file) and asserts the behavior locally instead.
  localOnly: true,
};

interface OrderNode {
  id: string;
  // Back-reference to the parent, creating a cycle once wired up.
  parent?: OrderNode;
  items: OrderNode[];
}

export const handler = withDurableExecution(
  async (event: { mode?: "circular" | "bigint" }, context: DurableContext) => {
    await context.step("prepare-order", async () => "ready");

    if (event.mode === "bigint") {
      // A BigInt cannot be serialized by JSON.stringify at all. When the SDK
      // logs this error in verbose mode, the safe stringifier catches the
      // failure and substitutes "[Unable to stringify]".
      const err = new Error(
        "Order total overflowed a safe integer",
      ) as Error & {
        total: bigint;
      };
      err.total = BigInt("9007199254740993");
      throw err;
    }

    // Build an order graph with a parent/child cycle plus a shared reference.
    // A plain JSON.stringify would throw "Converting circular structure to
    // JSON"; the SDK's logger replaces the offending references with
    // "[Circular]" so the error still gets logged.
    const root: OrderNode = { id: "order-1", items: [] };
    const line: OrderNode = { id: "line-1", parent: root, items: [] };
    root.items.push(line);
    const err = new Error("Failed to reconcile order graph") as Error & {
      order: OrderNode;
      alsoOrder: OrderNode;
    };
    err.order = root;
    err.alsoOrder = root; // shared reference to the same node
    throw err;
  },
);
