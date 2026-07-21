// 4-17: Two callbacks — sequential create and wait (cbA, wcbA, cbB, wcbB)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [nameA, nameB] = event as [string, string];

    const [callbackPromiseA] = await context.createCallback<string>(nameA);
    const resultA = await callbackPromiseA;

    const [callbackPromiseB] = await context.createCallback<string>(nameB);
    const resultB = await callbackPromiseB;

    return { a: resultA, b: resultB };
  },
);
