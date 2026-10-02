import { satisfies } from "semver";
import {
  InstalledCoreFixture,
  invocationFixture,
} from "./helpers/installed-core-fixture";

// These tests require the core and OTel build artifacts, as does repository CI.
describe("installed core compatibility for invocation-local headers", () => {
  let previous: InstalledCoreFixture;
  let current: InstalledCoreFixture;
  beforeAll(() => {
    previous = new InstalledCoreFixture(true);
    current = new InstalledCoreFixture(false);
  }, 30000);
  afterAll(() => {
    previous?.cleanup();
    current?.cleanup();
  });

  it("excludes the published core that cannot supply the header and accepts the new minor", () => {
    expect(previous.coreVersion).toBe("2.6.0");
    expect(previous.peerAccepted).toBe(false);
    const invalid = previous.validateInstalledPeers();
    expect(invalid.status).not.toBe(0);
    expect(invalid.output).toContain(
      "invalid: @aws/durable-execution-sdk-js@2.6.0",
    );
    expect(current.coreRequired).toBe(true);
    expect(satisfies("2.7.0", current.peerRange)).toBe(true);
    expect(satisfies("2.7.1", current.peerRange)).toBe(true);
    expect(satisfies("3.0.0", current.peerRange)).toBe(false);
    expect(current.peerAccepted).toBe(true);
    expect(current.validateInstalledPeers().status).toBe(0);
  });

  it.each(["ExecutionOtelPlugin", "InvocationOtelPlugin"])(
    "proves the installed %s sees sampling/header metadata only with the new core",
    (view) => {
      const probe = `${invocationFixture}
(async () => {
  const exporter = new InMemorySpanExporter();
  let provider;
  const plugin = new otel.${view}({ tracerProviderFactory: ids => provider = new NodeTracerProvider({ idGenerator: ids(), sampler: new AlwaysOnSampler(), spanProcessors: [new SimpleSpanProcessor(exporter)] }) });
  let seen;
  const handler = core.withDurableExecution(async () => 'ok', { plugins: [{ onInvocationStart: async info => { seen = info.xRayTraceId; } }, plugin] });
  const header = 'Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=0';
  const result = await handler(event, { ...lambdaContext, xRayTraceId: header });
  const output = { result, headerForwarded: seen === header, exports: exporter.getFinishedSpans().length, corePath: require.resolve('@aws/durable-execution-sdk-js') };
  await provider.shutdown();
  process.stdout.write(JSON.stringify(output));
})().catch(error => { console.error(error); process.exitCode = 1; });`;
      const oldResult = previous.run<{
        headerForwarded: boolean;
        exports: number;
        corePath: string;
      }>(probe);
      const newResult = current.run<{
        headerForwarded: boolean;
        exports: number;
        corePath: string;
      }>(probe);
      expect(oldResult.corePath).toContain(previous.directory);
      expect(oldResult.headerForwarded).toBe(false);
      expect(oldResult.exports).toBeGreaterThan(0);
      expect(newResult.corePath).toContain(current.directory);
      expect(newResult.headerForwarded).toBe(true);
      expect(newResult.exports).toBe(0);
    },
  );
});
