// 4-18: Two callbacks — create both then wait in order (cbA, cbB, wcbA, wcbB)
import {
  DurableContext,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    const [nameA, nameB] = event as [string, string];

    const [callbackPromiseA] = await context.createCallback<string>(nameA);
    const [callbackPromiseB] = await context.createCallback<string>(nameB);

    const resultA = await callbackPromiseA;
    const resultB = await callbackPromiseB;

    return { a: resultA, b: resultB };
  },
);
