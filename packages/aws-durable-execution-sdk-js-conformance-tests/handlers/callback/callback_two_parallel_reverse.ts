// 4-19: Two callbacks — create both then wait in reverse order (cbA, cbB, wcbB, wcbA)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [nameA, nameB] = event as [string, string];

    const [callbackPromiseA] = await context.createCallback<string>(nameA);
    const [callbackPromiseB] = await context.createCallback<string>(nameB);

    const resultB = await callbackPromiseB;
    const resultA = await callbackPromiseA;

    return { a: resultA, b: resultB };
  },
);
