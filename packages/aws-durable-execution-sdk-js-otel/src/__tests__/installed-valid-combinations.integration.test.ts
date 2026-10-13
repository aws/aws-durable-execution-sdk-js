import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  InstalledCoreFixture,
  invocationFixture,
} from "./helpers/installed-core-fixture";

const header =
  "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1";
const combinations = (["minimum", "previous", "current"] as const).flatMap(
  (core) => [false, true].map((previousPlugin) => ({ core, previousPlugin })),
);

describe.each(combinations)(
  "valid installed on-demand configuration: core=$core previousPlugin=$previousPlugin",
  ({ core, previousPlugin }) => {
    let fixture: InstalledCoreFixture;
    beforeAll(() => {
      fixture = new InstalledCoreFixture(core, { previousPlugin });
    }, 30000);
    afterAll(() => fixture?.cleanup());
    it("keeps package peers and the public TypeScript registration compatible", () => {
      expect(fixture.peerAccepted).toBe(true);
      expect(fixture.coreRequired).toBe(false);
      const peers = fixture.validateInstalledPeers();
      expect(peers.output).not.toContain("invalid:");
      expect(peers.status).toBe(0);
      const types = fixture.typecheckConsumer(`
      import { withDurableExecution } from '@aws/durable-execution-sdk-js';
      import { ExecutionOtelPlugin, InvocationOtelPlugin } from '@aws/durable-execution-sdk-js-otel';
      withDurableExecution(async () => 'ok', { plugins: [new ExecutionOtelPlugin()] });
      withDurableExecution(async () => 'ok', { plugins: [new InvocationOtelPlugin()] });
      class LegacyPlugin { registration = 42; async onInvocationStart() {} }
      withDurableExecution(async () => 'ok', { plugins: [new LegacyPlugin()] });
    `);
      expect(types.output).toBe("");
      expect(types.status).toBe(0);
    }, 30000);
    it.each(["ExecutionOtelPlugin", "InvocationOtelPlugin"])(
      "preserves %s and the environment carrier",
      (view) => {
        const result = fixture.run<{
          status: string;
          names: string[];
          traceIds: string[];
          corePath: string;
          otelPath: string;
        }>(
          `${invocationFixture}
(async () => {
  const exporter = new InMemorySpanExporter(); let provider;
  const plugin = new otel.${view}({ tracerProviderFactory: ids => provider = new NodeTracerProvider({ idGenerator: ids(), spanProcessors: [new SimpleSpanProcessor(exporter)] }) });
  const response = await core.withDurableExecution(async () => 'ok', { plugins: [plugin, { onInvocationStart: async () => {}, get registration() { throw new Error('ordinary property must not be read'); } }] })(event, lambdaContext);
  const spans = exporter.getFinishedSpans();
  const result = { status: response.Status, names: spans.map(s => s.name).sort(), traceIds: spans.map(s => s.spanContext().traceId), corePath: require.resolve('@aws/durable-execution-sdk-js'), otelPath: require.resolve('@aws/durable-execution-sdk-js-otel') };
  await provider.shutdown(); process.stdout.write(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });`,
          { _X_AMZN_TRACE_ID: header },
        );
        expect(result.corePath).toContain(fixture.applicationDirectory);
        expect(result.otelPath).toContain(fixture.applicationDirectory);
        expect(result.status).toBe("SUCCEEDED");
        expect(result.names).toEqual(["Invocation", "Workflow"]);
        expect(new Set(result.traceIds)).toEqual(
          new Set(["5759e988bd862e3fe1be46a994272793"]),
        );
      },
    );
  },
);

describe.each(["previous", "current"] as const)(
  "OTel-only layer with %s application core",
  (core) => {
    let fixture: InstalledCoreFixture;
    beforeAll(() => {
      fixture = new InstalledCoreFixture(core, { layer: true });
    }, 30000);
    afterAll(() => fixture?.cleanup());
    it.each(["execution", "invocation"])(
      "loads the %s provider from a separate tree with the original API version",
      (view) => {
        expect(
          existsSync(
            join(
              fixture.applicationDirectory,
              "node_modules/@aws/durable-execution-sdk-js-otel",
            ),
          ),
        ).toBe(false);
        expect(
          existsSync(
            join(
              fixture.layerDirectory!,
              "node_modules/@aws/durable-execution-sdk-js",
            ),
          ),
        ).toBe(false);
        const result = fixture.run<{
          status: string;
          names: string[];
          providerPath: string;
          version: number;
        }>(
          `${invocationFixture}
(async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }); provider.register();
  const specifier = '@aws/durable-execution-sdk-js-otel/otel-${view}';
  process.env.DURABLE_EXECUTION_PLUGINS = specifier;
  const response = await core.withDurableExecution(async () => 'ok')(event, lambdaContext);
  const result = { status: response.Status, names: exporter.getFinishedSpans().map(s => s.name).sort(), providerPath: require.resolve(specifier), version: require(specifier).durableExecutionPluginProvider.pluginApiVersion };
  await provider.shutdown(); process.stdout.write(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });`,
          { _X_AMZN_TRACE_ID: header },
        );
        expect(result.providerPath).toContain(fixture.layerDirectory);
        expect(result.version).toBe(1);
        expect(result.status).toBe("SUCCEEDED");
        expect(result.names).toEqual(["Invocation", "Workflow"]);
      },
    );
  },
);
