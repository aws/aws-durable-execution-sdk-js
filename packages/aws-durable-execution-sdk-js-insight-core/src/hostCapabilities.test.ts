/**
 * The host-capability contract, and the config coercion that follows from it.
 *
 * Two bugs motivate these tests, both the same shape — the UI offering an LLM
 * provider the host cannot reach:
 *
 *   Copilot was selectable in the desktop app, and every query using it threw.
 *   The on-device provider is selectable but cannot work in a packaged desktop
 *   app, where node-llama-cpp is not bundled.
 *
 * And one consequence: coercing only the Settings form left the display and the
 * behavior disagreeing (Settings showed "Amazon Bedrock" while the next query
 * failed citing Copilot) until the user happened to press Save. So these pin
 * that capabilities are *detected*, and that the provider the session uses is
 * the same one it reports.
 */
import { ExplorerSession } from "./explorerSession";
import { setCopilotBridge } from "./copilotBridge";
import {
  detectCapabilities,
  effectiveLlmProvider,
  isLocalLlmAvailable,
  withEffectiveProvider,
  type HostCapabilities,
} from "./hostCapabilities";
import type { Favorite, HostPort, SettingValue } from "./hostPort";
import { normalizeConfig, type InsightConfig } from "./configCore";

function config(overrides: Partial<InsightConfig> = {}): InsightConfig {
  return {
    ...normalizeConfig({
      getString: () => undefined,
      getBool: () => undefined,
      getNumber: () => undefined,
    }),
    ...overrides,
  };
}

function createHost(cfg: InsightConfig = config()): {
  host: HostPort;
  posted: Record<string, unknown>[];
} {
  const posted: Record<string, unknown>[] = [];
  const host: HostPort = {
    post: (m) => posted.push(m),
    readConfig: () => cfg,
    writeSettings: async (_values: Record<string, SettingValue>) => {},
    saveFile: async () => undefined,
    showInfo: () => {},
    readFavorites: (): Favorite[] => [],
    writeFavorites: async () => {},
  };
  return { host, posted };
}

/** The `config` message the session posts in response to "ready". */
async function ready(host: HostPort, posted: Record<string, unknown>[]) {
  await new ExplorerSession(host).dispatch({ type: "ready" });
  const msg = posted.find((m) => m.type === "config");
  expect(msg).toBeDefined();
  return msg as {
    capabilities: HostCapabilities;
    settings: { llmProvider: string };
  };
}

const BRIDGE = {
  selectModel: async () => null,
  listAllModelIds: async () => [],
};

describe("capability detection", () => {
  afterEach(() => setCopilotBridge(undefined));

  it("reports copilot as unavailable when no bridge is installed", async () => {
    // This is the desktop app: nothing ever calls setCopilotBridge.
    setCopilotBridge(undefined);
    const { host, posted } = createHost();
    expect((await ready(host, posted)).capabilities.copilot).toBe(false);
  });

  it("reports copilot as available once a bridge is installed", async () => {
    // This is the extension: activate() installs a bridge.
    setCopilotBridge(BRIDGE);
    const { host, posted } = createHost();
    expect((await ready(host, posted)).capabilities.copilot).toBe(true);
  });

  it("tracks the bridge rather than caching the first answer", async () => {
    // Guards "detected, not declared": a capability captured at construction or
    // hardcoded per host would fail this.
    setCopilotBridge(undefined);
    const a = createHost();
    expect((await ready(a.host, a.posted)).capabilities.copilot).toBe(false);

    setCopilotBridge(BRIDGE);
    const b = createHost();
    expect((await ready(b.host, b.posted)).capabilities.copilot).toBe(true);
  });

  it("reports the on-device provider by module resolvability", () => {
    // node-llama-cpp is a dependency of this package, so it resolves here — the
    // same answer the VSIX gives (it ships the module) and the opposite of a
    // packaged desktop app (which bundles no node_modules).
    expect(isLocalLlmAvailable()).toBe(true);
    expect(detectCapabilities().localLlm).toBe(true);
  });
});

describe("effectiveLlmProvider", () => {
  const none: HostCapabilities = { copilot: false, localLlm: false };
  const all: HostCapabilities = { copilot: true, localLlm: true };

  it("falls back to bedrock for providers the host cannot reach", () => {
    expect(effectiveLlmProvider("copilot", none)).toBe("bedrock");
    expect(effectiveLlmProvider("local", none)).toBe("bedrock");
  });

  it("leaves providers alone when the host supports them", () => {
    expect(effectiveLlmProvider("copilot", all)).toBe("copilot");
    expect(effectiveLlmProvider("local", all)).toBe("local");
  });

  it("never rewrites providers that need no host capability", () => {
    for (const caps of [none, all]) {
      expect(effectiveLlmProvider("bedrock", caps)).toBe("bedrock");
      expect(effectiveLlmProvider("local-server", caps)).toBe("local-server");
    }
  });

  it("returns the same config object when nothing changes", () => {
    const cfg = config({ llmProvider: "bedrock" });
    expect(withEffectiveProvider(cfg, none)).toBe(cfg);
  });

  it("does not mutate the config it narrows", () => {
    const cfg = config({ llmProvider: "copilot" });
    expect(withEffectiveProvider(cfg, none).llmProvider).toBe("bedrock");
    expect(cfg.llmProvider).toBe("copilot");
  });
});

describe("the reported provider matches the one that will be used", () => {
  afterEach(() => setCopilotBridge(undefined));

  it("narrows a carried-over copilot setting before reporting it", async () => {
    // The desktop case: a settings file written by the extension names copilot.
    // Reporting it verbatim is what made Settings disagree with the next query.
    setCopilotBridge(undefined);
    const { host, posted } = createHost(config({ llmProvider: "copilot" }));
    const msg = await ready(host, posted);
    expect(msg.settings.llmProvider).toBe("bedrock");
    expect(msg.capabilities.copilot).toBe(false);
  });

  it("reports copilot verbatim where it is supported", async () => {
    setCopilotBridge(BRIDGE);
    const { host, posted } = createHost(config({ llmProvider: "copilot" }));
    const msg = await ready(host, posted);
    expect(msg.settings.llmProvider).toBe("copilot");
    expect(msg.capabilities.copilot).toBe(true);
  });

  it("only reports a provider it also declares as available", async () => {
    // The invariant that ties the two halves together: whatever provider the
    // config message names must be one its own capabilities permit.
    for (const bridge of [undefined, BRIDGE]) {
      for (const stored of [
        "bedrock",
        "copilot",
        "local",
        "local-server",
      ] as const) {
        setCopilotBridge(bridge);
        const { host, posted } = createHost(config({ llmProvider: stored }));
        const msg = await ready(host, posted);
        const { capabilities, settings } = msg;
        if (settings.llmProvider === "copilot") {
          expect(capabilities.copilot).toBe(true);
        }
        if (settings.llmProvider === "local") {
          expect(capabilities.localLlm).toBe(true);
        }
      }
    }
  });
});
