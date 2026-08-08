import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import releaseVariant from "@jitl/quickjs-singlefile-cjs-release-sync";

// The WASM module is expensive to instantiate but stateless and reusable, so
// build it once (lazily) and share it. Per-call isolation is unaffected: each
// runSandboxedJs still creates its own runtime + context from this module.
let modulePromise:
  | ReturnType<typeof newQuickJSWASMModuleFromVariant>
  | undefined;
function getQuickJSModule() {
  // Cache the successful instantiation, but if it rejects, clear the cache so
  // a later call can retry rather than being stuck with a permanently-rejected
  // promise.
  if (!modulePromise) {
    modulePromise = newQuickJSWASMModuleFromVariant(releaseVariant).catch(
      (err) => {
        modulePromise = undefined;
        throw err;
      },
    );
  }
  return modulePromise;
}

/**
 * Runs untrusted (LLM-generated) JavaScript in a QuickJS WebAssembly VM with
 * NO access to the host: no `require`, no `process`, no filesystem, no network,
 * no Node globals. The only things the code can see are the `rows` and
 * `columns` we explicitly inject. Bounded by a wall-clock timeout (interrupt
 * handler) and a memory limit. This is a real security boundary — unlike Node's
 * `vm` module or a bare `worker_threads` Worker, both of which still expose the
 * full Node API surface (and thus the filesystem, env vars, and network) to the
 * code they run.
 *
 * The code runs as a function body and should `return` its result. The return
 * value is marshalled back out as a plain JS value (JSON-compatible).
 */
export interface SandboxResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export async function runSandboxedJs(
  code: string,
  data: { rows: Array<Record<string, unknown>>; columns: string[] },
  opts?: { timeoutMs?: number; memoryBytes?: number },
): Promise<SandboxResult> {
  const timeoutMs = opts?.timeoutMs ?? 3000;
  const memoryBytes = opts?.memoryBytes ?? 64 * 1024 * 1024;

  const QuickJS = await getQuickJSModule();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(memoryBytes);
  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(() => Date.now() > deadline);

  const vm = runtime.newContext();
  try {
    // Inject the data as a parsed-JSON string literal rather than
    // interpolating it as object/array literal syntax. The data is confined to
    // a single string token that JSON.parse turns back into the value, so it
    // can never be part of the code grammar — more robust than relying on
    // "JSON is a subset of JS literals". (No host references are bridged in.)
    const rowsJson = JSON.stringify(data.rows);
    const columnsJson = JSON.stringify(data.columns);
    const setup = `globalThis.rows = JSON.parse(${JSON.stringify(
      rowsJson,
    )}); globalThis.columns = JSON.parse(${JSON.stringify(columnsJson)});`;
    const setupRes = vm.evalCode(setup);
    if (setupRes.error) {
      setupRes.error.dispose();
      return { ok: false, error: "Failed to initialize sandbox data." };
    }
    setupRes.value.dispose();

    // The user code runs as a function body and returns its result.
    const wrapped = `(function () {\n${code}\n})()`;
    const res = vm.evalCode(wrapped);
    if (res.error) {
      const err = vm.dump(res.error);
      res.error.dispose();
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : typeof err === "string"
            ? err
            : JSON.stringify(err);
      return { ok: false, error: msg };
    }
    const value = vm.dump(res.value);
    res.value.dispose();
    return { ok: true, value };
  } catch (e) {
    // Interrupt (timeout) and out-of-memory surface here.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
