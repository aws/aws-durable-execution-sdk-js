import { afterAll, beforeAll, expect, it } from "vitest";
import {
  InstalledCoreFixture,
  invocationFixture,
} from "./helpers/installed-core-fixture";

let fixture: InstalledCoreFixture;
beforeAll(() => {
  fixture = new InstalledCoreFixture("current");
}, 30000);
afterAll(() => fixture?.cleanup());

it.each(["require", "import"])(
  "loads the new and existing APIs from the packed %s package",
  (loader) => {
    const result = fixture.run<{
      names: string[];
      oldFactories: boolean;
      defaultName: string;
    }>(`
(async () => {
  const load = ${loader === "require" ? "async (name) => require(name)" : "(name) => import(name)"};
  const root = await load('@aws/durable-execution-sdk-js-otel');
  const execution = await load('@aws/durable-execution-sdk-js-otel/otel-execution');
  const invocation = await load('@aws/durable-execution-sdk-js-otel/otel-invocation');
  const registration = Symbol.for('aws.lambda.durable.instrumentation.plugin-registration');
  const factories = [root.OtelPlugin.factory(), root.OtelPlugin.factory({mode:'invocation'}), execution.durableExecutionPluginProvider, invocation.durableExecutionPluginProvider];
  process.stdout.write(JSON.stringify({names: factories.map(f => f[registration].name), oldFactories: typeof root.createExecutionOtelPluginFactory === 'function' && typeof root.createInvocationOtelPluginFactory === 'function', defaultName: root.durableExecutionPluginProvider[registration].name}));
})().catch(e => { console.error(e); process.exitCode = 1; });`);
    expect(result).toEqual({
      names: [
        "ExecutionOtelPlugin",
        "InvocationOtelPlugin",
        "ExecutionOtelPlugin",
        "InvocationOtelPlugin",
      ],
      oldFactories: true,
      defaultName: "ExecutionOtelPlugin",
    });
  },
);

it.each(["", "/otel-execution", "/otel-invocation"])(
  "loads the packed %s environment entry point through the public handler",
  (suffix) => {
    const result = fixture.run<{ status: string; names: string[] }>(
      `${invocationFixture}
(async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({spanProcessors: [new SimpleSpanProcessor(exporter)]});
  provider.register();
  const output = await core.withDurableExecution(async () => 'ok')(event, lambdaContext);
  process.stdout.write(JSON.stringify({status: output.Status, names: exporter.getFinishedSpans().map(span => span.name)}));
  await provider.shutdown();
})().catch(e => { console.error(e); process.exitCode = 1; });`,
      {
        DURABLE_EXECUTION_PLUGINS: `@aws/durable-execution-sdk-js-otel${suffix}`,
      },
    );
    expect(result.status).toBe("SUCCEEDED");
    expect(result.names.filter((name) => name === "Workflow")).toHaveLength(1);
    expect(result.names.filter((name) => name === "Invocation")).toHaveLength(
      1,
    );
  },
);

it.each([false, true])(
  "publishes precise factory options (exact optional properties=%s)",
  (exactOptionalPropertyTypes) => {
    const result = fixture.typecheckConsumer(
      `
import { withDurableExecution } from '@aws/durable-execution-sdk-js';
import { OtelPlugin, type OtelPluginFactoryOptions, createExecutionOtelPluginFactory, createInvocationOtelPluginFactory } from '@aws/durable-execution-sdk-js-otel';
const options: OtelPluginFactoryOptions = { mode: 'invocation', workflowSpanName: 'workflow', enrichLogger: false };
for (const factory of [OtelPlugin.factory(), OtelPlugin.factory(options), createExecutionOtelPluginFactory(), createInvocationOtelPluginFactory()]) {
  withDurableExecution(async () => 'ok', { plugins: [factory] });
}
// @ts-expect-error Unsupported modes must not compile.
OtelPlugin.factory({ mode: 'other' });
// @ts-expect-error Null is not an omitted mode.
OtelPlugin.factory({ mode: null });
`,
      exactOptionalPropertyTypes,
      // Core logger declarations have pre-existing exact-optional errors. Check
      // consumer calls in that mode; the default case also checks declarations.
      exactOptionalPropertyTypes,
    );
    expect(result.output).toBe("");
    expect(result.status).toBe(0);
  },
  30000,
);
