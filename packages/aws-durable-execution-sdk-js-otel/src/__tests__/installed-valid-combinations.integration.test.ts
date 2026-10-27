import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  InstalledCoreFixture,
  invocationFixture,
} from "./helpers/installed-core-fixture";

const header =
  "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1";
// Released 2.x/1.x configurations remain controls; the major uses the new pair.
const combinations = [
  { core: "minimum", previousPlugin: true },
  { core: "previous", previousPlugin: true },
  { core: "current", previousPlugin: false },
] as const;

describe.each(combinations)(
  "installed supported pair: core=$core oldPlugin=$previousPlugin",
  ({ core, previousPlugin }) => {
    let fixture: InstalledCoreFixture;
    beforeAll(() => {
      fixture = new InstalledCoreFixture(core, { previousPlugin });
    }, 30000);
    afterAll(() => fixture?.cleanup());
    it("accepts package peers and strict public declaration consumers", () => {
      expect(fixture.peerAccepted).toBe(true);
      expect(fixture.coreRequired).toBe(false);
      expect(fixture.validateInstalledPeers().status).toBe(0);
      const registrations = previousPlugin
        ? `
      import { ExecutionOtelPlugin, InvocationOtelPlugin } from '@aws/durable-execution-sdk-js-otel';
      withDurableExecution(async () => 'ok', {plugins:[new ExecutionOtelPlugin()]});
      withDurableExecution(async () => 'ok', {plugins:[new InvocationOtelPlugin()]});
      class CustomPlugin { registration=42; async onInvocationStart() {} }
      withDurableExecution(async () => 'ok', {plugins:[new CustomPlugin()]});
    `
        : `
      import { createExecutionOtelPluginFactory, createInvocationOtelPluginFactory } from '@aws/durable-execution-sdk-js-otel';
      withDurableExecution(async () => 'ok', {plugins:[createExecutionOtelPluginFactory()]});
      withDurableExecution(async () => 'ok', {plugins:[createInvocationOtelPluginFactory()]});
      class CustomFactory { registration=42; createPlugin() {return {async onInvocationStart() {}};} }
      withDurableExecution(async () => 'ok', {plugins:[new CustomFactory()]});
    `;
      const result = fixture.typecheckConsumer(
        `import {withDurableExecution} from '@aws/durable-execution-sdk-js'; ${registrations}`,
      );
      expect(result.output).toBe("");
      expect(result.status).toBe(0);
    }, 30000);
    it.each(["ExecutionOtelPlugin", "InvocationOtelPlugin"])(
      "records %s through the supported registration API",
      (view) => {
        const result = fixture.run<{
          status: string;
          names: string[];
          traceIds: string[];
          corePath: string;
          otelPath: string;
        }>(
          `${invocationFixture}
(async()=>{
 const exporter=new InMemorySpanExporter(); let provider;
 const config={tracerProviderFactory:ids=>provider=new NodeTracerProvider({idGenerator:ids(),spanProcessors:[new SimpleSpanProcessor(exporter)]})};
 const plugin=${previousPlugin ? `new otel.${view}(config)` : `otel.create${view}Factory(config)`};
 const observer={onInvocationStart:async()=>{}};
 const extra=${previousPlugin ? "observer" : "{createPlugin:()=>observer}"};
 Object.defineProperty(extra,'registration',{get(){throw new Error('ordinary property must not be read');}});
 const result=await core.withDurableExecution(async()=> 'ok',{plugins:[plugin,extra]})(event,lambdaContext);
 const spans=exporter.getFinishedSpans();
 const output={status:result.Status,names:spans.map(s=>s.name).sort(),traceIds:spans.map(s=>s.spanContext().traceId),corePath:require.resolve('@aws/durable-execution-sdk-js'),otelPath:require.resolve('@aws/durable-execution-sdk-js-otel')};
 await provider.shutdown(); process.stdout.write(JSON.stringify(output));
})().catch(e=>{console.error(e);process.exitCode=1;});`,
          { _X_AMZN_TRACE_ID: header },
        );
        expect(realpathSync(result.corePath)).toContain(
          realpathSync(fixture.applicationDirectory),
        );
        expect(realpathSync(result.otelPath)).toContain(
          realpathSync(fixture.applicationDirectory),
        );
        expect(result.status).toBe("SUCCEEDED");
        expect(result.names).toEqual(["Invocation", "Workflow"]);
        expect(new Set(result.traceIds)).toEqual(
          new Set(["5759e988bd862e3fe1be46a994272793"]),
        );
      },
    );
  },
);

describe.each([false, true])(
  "major core with separate layer: oldPlugin=%s",
  (previousPlugin) => {
    let fixture: InstalledCoreFixture;
    beforeAll(() => {
      fixture = new InstalledCoreFixture("current", {
        previousPlugin,
        layer: true,
      });
    }, 30000);
    afterAll(() => fixture?.cleanup());
    it.each(["execution", "invocation"])(
      "loads or rejects the %s provider at the declared migration boundary",
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
          error?: { ErrorType: string; ErrorMessage: string };
          calls: number;
          names: string[];
          providerPath: string;
        }>(
          `${invocationFixture}
(async()=>{
 const exporter=new InMemorySpanExporter();const provider=new NodeTracerProvider({spanProcessors:[new SimpleSpanProcessor(exporter)]});provider.register();
 const specifier='@aws/durable-execution-sdk-js-otel/otel-${view}';process.env.DURABLE_EXECUTION_PLUGINS=specifier;
 let calls=0;const result=await core.withDurableExecution(async()=>{calls++;return 'ok';})(event,lambdaContext);
 const output={status:result.Status,error:result.Error,calls,names:exporter.getFinishedSpans().map(s=>s.name).sort(),providerPath:require.resolve(specifier)};
 await provider.shutdown();process.stdout.write(JSON.stringify(output));
})().catch(e=>{console.error(e);process.exitCode=1;});`,
          { _X_AMZN_TRACE_ID: header },
        );
        expect(realpathSync(result.providerPath)).toContain(
          realpathSync(fixture.layerDirectory!),
        );
        expect(result.status).toBe(previousPlugin ? "FAILED" : "SUCCEEDED");
        expect(result.calls).toBe(previousPlugin ? 0 : 1);
        expect(result.names).toEqual(
          previousPlugin ? [] : ["Invocation", "Workflow"],
        );
        if (previousPlugin) {
          expect(result.error?.ErrorType).toBe("PluginLoadError");
          expect(result.error?.ErrorMessage).toContain("legacy v1");
        }
      },
    );
  },
);

describe("published legacy provider in explicit major registration", () => {
  let fixture: InstalledCoreFixture;
  beforeAll(() => {
    fixture = new InstalledCoreFixture("current", { previousPlugin: true });
  }, 30000);
  afterAll(() => fixture?.cleanup());
  it.each(["execution", "invocation"])(
    "rejects explicit published %s provider before calling it",
    (view) => {
      const result = fixture.run<{
        status: string;
        type: string;
        handlerCalls: number;
        factoryCalls: number;
      }>(`${invocationFixture}
(async()=>{
 const legacy=require('@aws/durable-execution-sdk-js-otel/otel-${view}').durableExecutionPluginProvider;
 const create=legacy.createPlugin;let factoryCalls=0,handlerCalls=0;legacy.createPlugin=()=>{factoryCalls++;return create();};
 const response=await core.withDurableExecution(async()=>{handlerCalls++;return 'ok';},{plugins:[legacy]})(event,lambdaContext);
 process.stdout.write(JSON.stringify({status:response.Status,type:response.Error?.ErrorType,handlerCalls,factoryCalls}));
})().catch(e=>{console.error(e);process.exitCode=1;});`);
      expect(result).toEqual({
        status: "FAILED",
        type: "PluginLoadError",
        handlerCalls: 0,
        factoryCalls: 0,
      });
    },
  );
});
