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
    previous = new InstalledCoreFixture(true, { previousPlugin: true });
    current = new InstalledCoreFixture(false);
  }, 30000);
  afterAll(() => {
    previous?.cleanup();
    current?.cleanup();
  });

  it("requires the declared major pair and keeps released old-pair controls", () => {
    expect(previous.coreVersion).toBe("2.6.0");
    expect(previous.peerAccepted).toBe(true);
    expect(previous.validateInstalledPeers().status).toBe(0);
    expect(current.coreRequired).toBe(false);
    expect(satisfies("2.4.0", current.peerRange)).toBe(false);
    expect(satisfies("2.5.0", current.peerRange)).toBe(false);
    expect(satisfies("2.7.0", current.peerRange)).toBe(false);
    expect(satisfies("2.7.1", current.peerRange)).toBe(false);
    expect(satisfies("3.0.0", current.peerRange)).toBe(true);
    expect(current.peerAccepted).toBe(true);
    expect(current.validateInstalledPeers().status).toBe(0);
  });

  it("accepts all authoritative carrier values with exact optional properties", () => {
    for (const fixture of [current]) {
      const result = fixture.typecheckConsumer(
        `
import { deriveExecutionTraceId } from '@aws/durable-execution-sdk-js-otel';
declare const runtimeHeader: string | undefined;
const environment = { _X_AMZN_TRACE_ID: 'stale' };
const arn = 'arn:execution:types';
deriveExecutionTraceId(environment, arn, undefined, { xRayTraceId: runtimeHeader });
deriveExecutionTraceId(environment, arn, undefined, { xRayTraceId: undefined });
deriveExecutionTraceId(environment, arn, undefined, { xRayTraceId: null });
deriveExecutionTraceId(environment, arn, undefined, { xRayTraceId: '' });
deriveExecutionTraceId(environment, arn, undefined, {});
deriveExecutionTraceId(environment, arn);
`,
        true,
        // Released core logger declarations have unrelated exact-optional errors.
        // Check real consumer calls; existing strict declaration tests stay enabled.
        true,
      );
      expect(result.output).toBe("");
      expect(result.status).toBe(0);
    }
  });

  it.each(["ExecutionOtelPlugin", "InvocationOtelPlugin"])(
    "preserves absent-carrier fallback and isolates empty carriers with installed %s",
    (view) => {
      const probe = `${invocationFixture}
(async () => {
  const rows = [];
  for (const availability of ['absent', 'undefined', 'null', 'empty']) {
    const exporter = new InMemorySpanExporter();
    let provider;
    const config = { tracerProviderFactory: ids => provider = new NodeTracerProvider({ idGenerator: ids(), sampler: new AlwaysOnSampler(), spanProcessors: [new SimpleSpanProcessor(exporter)] }) };
    const modern = typeof otel.create${view}Factory === 'function';
    const plugin = modern ? otel.create${view}Factory(config) : new otel.${view}(config);
    let seen;
    const observer = { onInvocationStart: async info => { seen = info; } };
    const handler = core.withDurableExecution(async () => 'ok', { plugins: [modern ? { createPlugin: () => observer } : observer, plugin] });
    const runtimeContext = { ...lambdaContext };
    if (availability !== 'absent') Object.defineProperty(runtimeContext, 'xRayTraceId', { get: () => availability === 'undefined' ? undefined : availability === 'null' ? null : '' });
    const result = await handler(event, runtimeContext);
    rows.push({ availability, result: result.Status, carrierPresent: 'xRayTraceId' in seen, carrier: seen.xRayTraceId ?? null, traceIds: [...new Set(exporter.getFinishedSpans().map(span => span.spanContext().traceId))] });
    await provider.shutdown();
  }
  process.stdout.write(JSON.stringify(rows));
})().catch(error => { console.error(error); process.exitCode = 1; });`;
      for (const fixture of [previous, current]) {
        const rows = fixture.run<
          Array<{
            availability: string;
            result: string;
            carrierPresent: boolean;
            carrier: string | null;
            traceIds: string[];
          }>
        >(probe, {
          _X_AMZN_TRACE_ID:
            "Root=1-aaaaaaaa-aaaaaaaaaaaaaaaaaaaaaaaa;Parent=aaaaaaaaaaaaaaaa;Sampled=1",
        });
        expect(rows).toHaveLength(4);
        for (const row of rows) {
          expect(row.result).toBe("SUCCEEDED");
          expect(row.traceIds).toHaveLength(1);
          const authoritativeEmpty =
            fixture === current && row.availability !== "absent";
          expect(row.carrierPresent).toBe(authoritativeEmpty);
          expect(row.carrier).toBe(authoritativeEmpty ? "" : null);
          if (authoritativeEmpty)
            expect(row.traceIds[0]).not.toBe("a".repeat(32));
          else expect(row.traceIds[0]).toBe("a".repeat(32));
        }
      }
    },
  );

  it.each(["ExecutionOtelPlugin", "InvocationOtelPlugin"])(
    "proves the installed %s sees sampling/header metadata only with the new core",
    (view) => {
      const probe = `${invocationFixture}
(async () => {
  const exporter = new InMemorySpanExporter();
  let provider;
  const config = { tracerProviderFactory: ids => provider = new NodeTracerProvider({ idGenerator: ids(), sampler: new AlwaysOnSampler(), spanProcessors: [new SimpleSpanProcessor(exporter)] }) };
  const modern = typeof otel.create${view}Factory === 'function';
  const plugin = modern ? otel.create${view}Factory(config) : new otel.${view}(config);
  let seen;
  const observer = { onInvocationStart: async info => { seen = info.xRayTraceId; } };
  const handler = core.withDurableExecution(async () => 'ok', { plugins: [modern ? { createPlugin: () => observer } : observer, plugin] });
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
