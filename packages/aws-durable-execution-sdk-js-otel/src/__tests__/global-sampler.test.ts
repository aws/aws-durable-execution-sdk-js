import type { Tracer } from "@opentelemetry/api";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";
import {
  isDurableSamplerInstalled,
  tryInstallDurableSampler,
} from "../global-sampler";

describe("installed durable sampler authority", () => {
  let provider: NodeTracerProvider;
  afterEach(async () => provider?.shutdown());

  it("recognizes the installed bridge without evaluating a sampler", () => {
    const sampler = new AlwaysOnSampler();
    const query = jest.spyOn(sampler, "shouldSample");
    provider = new NodeTracerProvider({ sampler });
    const tracer = provider.getTracer("authority-unit");
    const bridge = tryInstallDurableSampler(tracer);
    expect(bridge).toBeDefined();
    expect(isDurableSamplerInstalled(tracer, bridge)).toBe(true);
    expect(isDurableSamplerInstalled(tracer, undefined)).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it("does not replace a customer's newer sampler to regain authority", () => {
    provider = new NodeTracerProvider();
    const tracer = provider.getTracer("authority-unit");
    const bridge = tryInstallDurableSampler(tracer);
    const replacement = new AlwaysOffSampler();
    const query = jest.spyOn(replacement, "shouldSample");
    Reflect.set(tracer, "_sampler", replacement);
    expect(isDurableSamplerInstalled(tracer, bridge)).toBe(false);
    expect(Reflect.get(tracer, "_sampler")).toBe(replacement);
    expect(query).not.toHaveBeenCalled();
  });

  it("treats opaque or inaccessible sampler state as unverified", () => {
    provider = new NodeTracerProvider();
    const tracer = provider.getTracer("authority-unit");
    const bridge = tryInstallDurableSampler(tracer);
    const opaque: Tracer = {
      startSpan: tracer.startSpan.bind(tracer),
      startActiveSpan: tracer.startActiveSpan.bind(tracer),
    };
    expect(isDurableSamplerInstalled(opaque, bridge)).toBe(false);
    Object.defineProperty(opaque, "_sampler", {
      get() {
        throw new Error("sampler is not exposed");
      },
    });
    expect(isDurableSamplerInstalled(opaque, bridge)).toBe(false);
  });
});
