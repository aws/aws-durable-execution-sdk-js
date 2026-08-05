/**
 * The host-capability contract.
 *
 * The renderer is one bundle running in two hosts, so it can only hide a
 * host-dependent option if the host tells it what it has. Copilot was initially
 * offered in the desktop app's Settings — selectable, and guaranteed to fail —
 * because the capability was never reported. These tests pin the reporting, and
 * pin that it is *derived* from the installed bridge rather than declared
 * separately, so the two can't disagree.
 */
import { ExplorerSession } from "./explorerSession";
import { setCopilotBridge } from "./copilotBridge";
import type { Favorite, HostPort, SettingValue } from "./hostPort";
import { normalizeConfig } from "./configCore";

function createHost(): {
  host: HostPort;
  posted: Record<string, unknown>[];
} {
  const posted: Record<string, unknown>[] = [];
  const host: HostPort = {
    post: (m) => posted.push(m),
    // An empty source means "every default", which is all these tests need.
    readConfig: () =>
      normalizeConfig({
        getString: () => undefined,
        getBool: () => undefined,
        getNumber: () => undefined,
      }),
    writeSettings: async (_values: Record<string, SettingValue>) => {},
    saveFile: async () => undefined,
    showInfo: () => {},
    readFavorites: (): Favorite[] => [],
    writeFavorites: async () => {},
  };
  return { host, posted };
}

/** The `config` message the session posts in response to "ready". */
async function readyConfig(host: HostPort, posted: Record<string, unknown>[]) {
  await new ExplorerSession(host).dispatch({ type: "ready" });
  const config = posted.find((m) => m.type === "config");
  expect(config).toBeDefined();
  return config as { capabilities: { copilot: boolean } };
}

describe("host capabilities", () => {
  afterEach(() => {
    setCopilotBridge(undefined);
  });

  it("reports copilot as unavailable when no bridge is installed", async () => {
    // This is the desktop app: nothing ever calls setCopilotBridge.
    setCopilotBridge(undefined);
    const { host, posted } = createHost();
    const config = await readyConfig(host, posted);
    expect(config.capabilities.copilot).toBe(false);
  });

  it("reports copilot as available once a bridge is installed", async () => {
    // This is the extension: activate() installs a bridge.
    setCopilotBridge({
      selectModel: async () => null,
      listAllModelIds: async () => [],
    });
    const { host, posted } = createHost();
    const config = await readyConfig(host, posted);
    expect(config.capabilities.copilot).toBe(true);
  });

  it("tracks the bridge rather than caching the first answer", async () => {
    // Guards the "derived, not declared" property: if the capability were
    // captured at construction or hardcoded per host, this would fail.
    setCopilotBridge(undefined);
    const a = createHost();
    expect((await readyConfig(a.host, a.posted)).capabilities.copilot).toBe(
      false,
    );

    setCopilotBridge({
      selectModel: async () => null,
      listAllModelIds: async () => [],
    });
    const b = createHost();
    expect((await readyConfig(b.host, b.posted)).capabilities.copilot).toBe(
      true,
    );
  });
});
