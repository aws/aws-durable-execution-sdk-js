// Sends the spans of one invocation. The handler returns only after onInvocationEnd
// settles. So a slow exporter would delay the handler, and a rejection would make the
// handler throw. A lost trace is acceptable. A failed workflow invocation is not. So
// this function waits at most timeoutMs, logs every failure, and never rejects.
export async function exportSpans(exporter, spans, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  const send = async () => {
    // A throw from export inside the executor rejects this promise.
    const result = await new Promise((resolve) =>
      exporter.export(spans, resolve),
    );
    // ExportResultCode.SUCCESS is 0.
    if (result?.code !== 0) throw result?.error ?? new Error("export failed");
    await exporter.forceFlush?.();
  };
  try {
    // Promise.race subscribes to send(). So a late rejection of send() is handled.
    await Promise.race([send(), timeout]);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: deliberate -- a failed export must be visible, and Lambda sends console output to CloudWatch.
    console.warn(
      `durable-execution-sdk-js-lite-otel: trace export failed: ${err?.message ?? err}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
