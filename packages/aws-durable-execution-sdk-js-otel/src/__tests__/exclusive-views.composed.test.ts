import { context, trace, ROOT_CONTEXT } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import {
  InvocationStatus,
  type InvocationInfo,
} from "@aws/durable-execution-sdk-js";
import type * as PluginLoader from "../../../aws-durable-execution-sdk-js/dist-types/utils/plugin/plugin-loader";
import type * as PluginRunner from "../../../aws-durable-execution-sdk-js/dist-types/utils/plugin/plugin-runner";

// Run the real core loader and runner. Use their built declarations so this
// package's typecheck does not compile core sources with OTel compiler options.
const { loadConfiguredPlugins } = jest.requireActual<typeof PluginLoader>(
  "../../../aws-durable-execution-sdk-js/src/utils/plugin/plugin-loader",
);
const { createPluginRunner } = jest.requireActual<typeof PluginRunner>(
  "../../../aws-durable-execution-sdk-js/src/utils/plugin/plugin-runner",
);
import { ExecutionOtelPlugin } from "../execution-plugin";
import { InvocationOtelPlugin } from "../invocation-plugin";

const info: InvocationInfo = {
  requestId: "first",
  executionArn: "arn:execution:exclusive",
  isFirstInvocation: true,
  executionInput: {},
  operations: {},
  updatedOperations: {},
};

describe("bundled OTel view registration", () => {
  let exporter: InMemorySpanExporter;
  let providers: NodeTracerProvider[];
  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    providers = [];
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
  });
  afterEach(async () => {
    await Promise.all(providers.map((p) => p.shutdown()));
    context.disable();
    trace.disable();
  });
  function make(
    Plugin: typeof ExecutionOtelPlugin | typeof InvocationOtelPlugin,
  ) {
    return new Plugin({
      contextExtractor: () => undefined,
      tracerProviderFactory: (ids) => {
        const provider = new NodeTracerProvider({
          idGenerator: ids(),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });
        providers.push(provider);
        return provider;
      },
    });
  }
  it.each([false, true])(
    "rejects both views before any export or context change (reverse=%s)",
    async (reverse) => {
      const classes = reverse
        ? [InvocationOtelPlugin, ExecutionOtelPlugin]
        : [ExecutionOtelPlugin, InvocationOtelPlugin];
      for (const explicitCount of [0, 1, 2]) {
        const plugins = classes.map((Plugin) => make(Plugin));
        const specifiers = classes
          .slice(explicitCount)
          .map((_, i) => `view-${i + explicitCount}`);
        await expect(
          loadConfiguredPlugins(plugins.slice(0, explicitCount), {
            environment: { DURABLE_EXECUTION_PLUGINS: specifiers.join(",") },
            importModule: async (specifier) => {
              const i = Number(specifier.slice(-1));
              return {
                durableExecutionPluginProvider: {
                  pluginApiVersion: 1,
                  pluginType: classes[i],
                  createPlugin: () => plugins[i],
                },
              };
            },
          }),
        ).rejects.toThrow(
          /(ExecutionOtelPlugin.*InvocationOtelPlugin|InvocationOtelPlugin.*ExecutionOtelPlugin).*Configure only one/,
        );
        expect(exporter.getFinishedSpans()).toHaveLength(0);
        expect(context.active()).toBe(ROOT_CONTEXT);
      }
    },
  );
  it.each([ExecutionOtelPlugin, InvocationOtelPlugin])(
    "keeps one view plus unrelated hooks valid across suspension and completion: %p",
    async (Plugin) => {
      for (const terminal of ["SUCCEEDED", "FAILED"] as const) {
        exporter.reset();
        const observer = { onInvocationStart: jest.fn(async () => undefined) };
        const plugins = await loadConfiguredPlugins([make(Plugin), observer], {
          environment: {},
        });
        const runner = createPluginRunner(plugins);
        for (const status of ["PENDING", terminal] as const) {
          const current = {
            ...info,
            isFirstInvocation: status === "PENDING",
            requestId: status,
          };
          await runner.onInvocationStart?.(current);
          await runner.wrapInvocation!(current, async () => {
            expect(trace.getSpan(context.active())).toBeDefined();
            await runner.onInvocationEnd?.({
              ...current,
              status,
              ...(status === "FAILED"
                ? { executionError: new Error("failed") }
                : {}),
            });
            if (status === "SUCCEEDED") {
              return { Status: InvocationStatus.SUCCEEDED, Result: '"ok"' };
            }
            if (status === "FAILED") {
              return {
                Status: InvocationStatus.FAILED,
                Error: { ErrorType: "Error", ErrorMessage: "failed" },
              };
            }
            return { Status: InvocationStatus.PENDING };
          });
          expect(context.active()).toBe(ROOT_CONTEXT);
        }
        expect(observer.onInvocationStart).toHaveBeenCalledTimes(2);
        const spans = exporter.getFinishedSpans();
        expect(spans.filter((span) => span.name === "Invocation")).toHaveLength(
          2,
        );
        expect(spans.filter((span) => span.name === "Workflow")).toHaveLength(
          1,
        );
      }
    },
  );

  it.each([false, true])(
    "rejects dynamic conflicts without constructing plugins or mutating the global tracer (reverse=%s)",
    async (reverse) => {
      const provider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      providers.push(provider);
      trace.setGlobalTracerProvider(provider);
      const tracer = provider.getTracer("aws-durable-execution-sdk-js");
      const sampler = Reflect.get(tracer, "_sampler");
      const idGenerator = Reflect.get(tracer, "_idGenerator");
      const classes = reverse
        ? [InvocationOtelPlugin, ExecutionOtelPlugin]
        : [ExecutionOtelPlugin, InvocationOtelPlugin];
      const factories = classes.map((Plugin) => jest.fn(() => new Plugin()));
      await expect(
        loadConfiguredPlugins([], {
          environment: { DURABLE_EXECUTION_PLUGINS: "first,second" },
          importModule: async (specifier) => {
            const i = specifier === "first" ? 0 : 1;
            return {
              durableExecutionPluginProvider: {
                pluginApiVersion: 1,
                pluginType: classes[i],
                createPlugin: factories[i],
              },
            };
          },
        }),
      ).rejects.toThrow(/mutually exclusive/);
      expect(Reflect.get(tracer, "_sampler")).toBe(sampler);
      expect(Reflect.get(tracer, "_idGenerator")).toBe(idGenerator);
      for (const factory of factories) expect(factory).not.toHaveBeenCalled();
      expect(exporter.getFinishedSpans()).toHaveLength(0);
      expect(context.active()).toBe(ROOT_CONTEXT);
    },
  );

  it("uses inherited static metadata and the concrete bundled subclass names", async () => {
    class CustomExecution extends ExecutionOtelPlugin {}
    class CustomInvocation extends InvocationOtelPlugin {}
    await expect(
      loadConfiguredPlugins([make(CustomExecution), make(CustomInvocation)], {
        environment: {},
      }),
    ).rejects.toThrow("Plugins 'CustomExecution' and 'CustomInvocation'");
  });
});
