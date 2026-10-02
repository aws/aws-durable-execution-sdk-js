import { satisfies } from "semver";
import {
  InstalledCoreFixture,
  invocationFixture,
} from "./helpers/installed-core-fixture";

function viewProbe(views: string[], explicitCount: number): string {
  return `${invocationFixture}
(async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ sampler: new AlwaysOnSampler(), spanProcessors: [new SimpleSpanProcessor(exporter)] });
  provider.register();
  const views = ${JSON.stringify(views)};
  process.env.DURABLE_EXECUTION_PLUGINS = views.slice(${explicitCount}).map(view => '@aws/durable-execution-sdk-js-otel/otel-' + (view === 'ExecutionOtelPlugin' ? 'execution' : 'invocation')).join(',');
  let handlerCalls = 0;
  const handler = core.withDurableExecution(async () => { handlerCalls++; return 'ok'; }, {
    plugins: [...views.slice(0, ${explicitCount}).map(view => new otel[view]()), {}],
  });
  let result, error;
  try { result = await handler(event, lambdaContext); }
  catch (caught) { error = { name: caught.name, message: caught.message }; }
  const output = { result, error, handlerCalls, spanNames: exporter.getFinishedSpans().map(span => span.name), corePath: require.resolve('@aws/durable-execution-sdk-js') };
  await provider.shutdown();
  process.stdout.write(JSON.stringify(output));
})().catch(error => { console.error(error); process.exitCode = 1; });`;
}

type ProbeResult = {
  result?: {
    Status: string;
    Error?: { ErrorType: string; ErrorMessage: string };
  };
  error?: { name: string; message: string };
  handlerCalls: number;
  spanNames: string[];
  corePath: string;
};

describe("installed core compatibility for exclusive OTel views", () => {
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

  it("excludes the released core that ignores view metadata and accepts the new minor", () => {
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

  it.each([
    [0, false],
    [0, true],
    [1, false],
    [1, true],
    [2, false],
    [2, true],
  ] as const)(
    "enforces effective configuration with %i explicit views (reverse=%s)",
    (explicitCount, reverse) => {
      const views = reverse
        ? ["InvocationOtelPlugin", "ExecutionOtelPlugin"]
        : ["ExecutionOtelPlugin", "InvocationOtelPlugin"];
      const probe = viewProbe(views, explicitCount);
      const oldResult = previous.run<ProbeResult>(probe);
      const newResult = current.run<ProbeResult>(probe);
      expect(oldResult.corePath).toContain(previous.directory);
      expect(oldResult.result?.Status).toBe("SUCCEEDED");
      expect(oldResult.handlerCalls).toBe(1);
      expect(
        oldResult.spanNames.filter((name) => name === "Workflow"),
      ).toHaveLength(2);
      expect(
        oldResult.spanNames.filter((name) => name === "Invocation"),
      ).toHaveLength(2);
      expect(newResult.corePath).toContain(current.directory);
      expect(newResult.error).toBeUndefined();
      expect(newResult.result?.Status).toBe("FAILED");
      expect(newResult.result?.Error?.ErrorType).toBe("PluginLoadError");
      expect(newResult.result?.Error?.ErrorMessage).toContain(
        "ExecutionOtelPlugin",
      );
      expect(newResult.result?.Error?.ErrorMessage).toContain(
        "InvocationOtelPlugin",
      );
      expect(newResult.handlerCalls).toBe(0);
      expect(newResult.spanNames).toEqual([]);
    },
    10000,
  );

  it.each(["ExecutionOtelPlugin", "InvocationOtelPlugin"])(
    "accepts one installed %s with an unrelated plugin",
    (view) => {
      const result = current.run<ProbeResult>(viewProbe([view], 1));
      expect(result.result?.Status).toBe("SUCCEEDED");
      expect(result.handlerCalls).toBe(1);
      expect(result.spanNames.sort()).toEqual(["Invocation", "Workflow"]);
    },
  );
});
