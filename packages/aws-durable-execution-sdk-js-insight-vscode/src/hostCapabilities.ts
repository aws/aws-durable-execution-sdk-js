/**
 * What the current host can actually do, and what that implies for config.
 *
 * Two of the four LLM providers are not universally available:
 *
 *   copilot   VS Code's Language Model API. Only exists in the extension host.
 *   local     node-llama-cpp, a native module loaded by dynamic import. The
 *             extension ships it (see .vscodeignore, which deliberately
 *             un-ignores it); a packaged desktop app does not, because
 *             electron-builder bundles only `dist/` and no node_modules.
 *
 * Both are *detected* rather than declared per host. That matters: a declared
 * flag is a second source of truth that can disagree with what the code actually
 * does at runtime, which is precisely how "Copilot" came to be selectable in the
 * desktop app while every query using it threw.
 *
 * {@link effectiveLlmProvider} closes the same loop for stored settings. A
 * settings file can name a provider this host cannot reach — trivially, by being
 * carried from the extension to the desktop app — so the provider the session
 * *uses* and the provider it *reports to the UI* both go through here. Without
 * it, Settings can display one provider while the next query fails citing
 * another.
 */
import { getCopilotBridge } from "./copilotBridge";
import type { InsightConfig } from "./configCore";

export interface HostCapabilities {
  /** Whether the "copilot" provider is usable (a bridge has been installed). */
  copilot: boolean;
  /** Whether the "local" on-device provider is usable (node-llama-cpp resolves). */
  localLlm: boolean;
}

/**
 * Whether node-llama-cpp can be loaded in this process.
 *
 * `require.resolve` rather than an import: it answers the question without
 * paying to instantiate a large native module, and it stays truthful across all
 * three builds — the VSIX (ships it), a desktop dev checkout (finds it hoisted
 * in the workspace root), and a packaged desktop app (does not, so this reports
 * false and the UI stops offering it).
 *
 * Memoized because Node caches *successful* resolutions but not failures: in a
 * packaged app, where the answer is always no, every uncached call would walk the
 * directory chain and throw. Config reads are per-query rather than
 * per-keystroke, so that was never material — but the answer also cannot change
 * within a process, so there is no reason to pay for it twice.
 */
let localLlmAvailable: boolean | undefined;

export function isLocalLlmAvailable(): boolean {
  if (localLlmAvailable === undefined) {
    try {
      require.resolve("node-llama-cpp");
      localLlmAvailable = true;
    } catch {
      localLlmAvailable = false;
    }
  }
  return localLlmAvailable;
}

/**
 * Detect this host's capabilities.
 *
 * Cheap enough to call on every config read: the Copilot check is a variable
 * read, and the on-device check is memoized above.
 */
export function detectCapabilities(): HostCapabilities {
  return {
    copilot: getCopilotBridge() !== undefined,
    localLlm: isLocalLlmAvailable(),
  };
}

/**
 * The provider that will actually be used, given what this host supports.
 *
 * Falls back to Bedrock, which needs no host capability beyond AWS credentials
 * the app already requires.
 */
export function effectiveLlmProvider(
  provider: InsightConfig["llmProvider"],
  capabilities: HostCapabilities,
): InsightConfig["llmProvider"] {
  if (provider === "copilot" && !capabilities.copilot) return "bedrock";
  if (provider === "local" && !capabilities.localLlm) return "bedrock";
  return provider;
}

/**
 * `config` with its provider replaced by the one this host can honor.
 *
 * Returns the same object when nothing changes, so the common case allocates
 * nothing.
 */
export function withEffectiveProvider(
  config: InsightConfig,
  capabilities: HostCapabilities,
): InsightConfig {
  const llmProvider = effectiveLlmProvider(config.llmProvider, capabilities);
  return llmProvider === config.llmProvider
    ? config
    : { ...config, llmProvider };
}
