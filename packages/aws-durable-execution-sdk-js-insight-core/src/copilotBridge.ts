/**
 * The seam for Copilot-backed generation.
 *
 * The "copilot" LLM provider is the one capability that genuinely cannot be
 * shared between hosts: it is VS Code's Language Model API (`vscode.lm`), which
 * only exists inside the extension host. Rather than let that single dependency
 * pull `import * as vscode` into llm.ts — and with it the whole prompt/parse
 * layer that every other provider shares — llm.ts talks to this port and the VS
 * Code activation path installs an implementation.
 *
 * Hosts that have no Copilot (the desktop app) simply never register one, so
 * selecting the provider there fails with a clear message instead of a
 * `Cannot find module 'vscode'` at load time.
 */

/** A single chat model, already selected. */
export interface CopilotModel {
  /**
   * Send these messages as consecutive user-role turns and return the full
   * response text, with streamed chunks already concatenated.
   */
  send(userMessages: string[]): Promise<string>;
}

export interface CopilotBridge {
  /** The preferred Copilot model, or null when the host has none available. */
  selectModel(): Promise<CopilotModel | null>;
  /**
   * Every model the host can see, as `vendor/family/id` strings. Used only to
   * make the "no Copilot model found" error actionable.
   */
  listAllModelIds(): Promise<string[]>;
}

let bridge: CopilotBridge | undefined;

/** Install the host's Copilot implementation (VS Code does this on activate). */
export function setCopilotBridge(impl: CopilotBridge | undefined): void {
  bridge = impl;
}

/** The installed bridge, or undefined when this host has no Copilot support. */
export function getCopilotBridge(): CopilotBridge | undefined {
  return bridge;
}

/**
 * The installed bridge, or a thrown explanation. Use where the caller cannot
 * meaningfully continue without Copilot.
 */
export function requireCopilotBridge(): CopilotBridge {
  if (!bridge) {
    throw new Error(
      "The Copilot provider is only available inside VS Code. Choose a different LLM provider (Bedrock, a local model, or a local server) in Settings.",
    );
  }
  return bridge;
}
