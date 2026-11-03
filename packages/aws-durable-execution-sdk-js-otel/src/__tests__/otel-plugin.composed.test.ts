import { expect, it, vi } from "vitest";
import type * as PluginLoader from "../../../aws-durable-execution-sdk-js/dist-types/utils/plugin/plugin-loader";
import {
  createOtelPluginFactory,
  durableExecutionPluginProvider,
} from "../index";
import { createExecutionOtelPluginFactory } from "../execution-plugin";
import { createInvocationOtelPluginFactory } from "../invocation-plugin";

const { loadConfiguredPlugins } = await vi.importActual<typeof PluginLoader>(
  "../../../aws-durable-execution-sdk-js/src/utils/plugin/plugin-loader",
);

it.each(["execution", "invocation"] as const)(
  "retains exclusivity between unified %s and existing factory registrations",
  async (mode) => {
    const createProvider = vi.fn();
    const unified = createOtelPluginFactory({
      mode,
      tracerProviderFactory: createProvider,
    });
    const existing =
      mode === "execution"
        ? createInvocationOtelPluginFactory({
            tracerProviderFactory: createProvider,
          })
        : createExecutionOtelPluginFactory({
            tracerProviderFactory: createProvider,
          });
    for (const factories of [
      [unified, existing],
      [existing, unified],
    ]) {
      for (const explicitCount of [0, 1, 2]) {
        const names = factories
          .slice(explicitCount)
          .map((_, index) => `view-${index + explicitCount}`);
        await expect(
          loadConfiguredPlugins(factories.slice(0, explicitCount), {
            environment: { DURABLE_EXECUTION_PLUGINS: names.join(",") },
            importModule: async (specifier) => ({
              durableExecutionPluginProvider:
                factories[Number(specifier.at(-1))],
            }),
          }),
        ).rejects.toThrow(
          /(ExecutionOtelPlugin.*InvocationOtelPlugin|InvocationOtelPlugin.*ExecutionOtelPlugin).*Configure only one/,
        );
      }
    }
    expect(createProvider).not.toHaveBeenCalled();
  },
);

it("rejects the default package provider combined with an explicit invocation view", async () => {
  await expect(
    loadConfiguredPlugins([createOtelPluginFactory({ mode: "invocation" })], {
      environment: {
        DURABLE_EXECUTION_PLUGINS: "@aws/durable-execution-sdk-js-otel",
      },
      importModule: async () => ({ durableExecutionPluginProvider }),
    }),
  ).rejects.toThrow("durable-opentelemetry-view");
});
