import * as vscode from "vscode";
import { registerCopilotBridge } from "./llm";

/**
 * Installs the VS Code Copilot bridge into the vscode-free `llm` module so the
 * "copilot" LLM provider works in the extension host. Keeping the `vscode.lm`
 * calls here (rather than in `llm.ts`) lets non-VS-Code hosts reuse the LLM
 * module's Bedrock/local providers without pulling in `vscode`.
 */
export function installCopilotBridge(): void {
  registerCopilotBridge({
    async complete(prompt: string): Promise<string> {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (models.length === 0) {
        const all = await vscode.lm.selectChatModels();
        const available = all
          .map((m) => `${m.vendor}/${m.family}/${m.id}`)
          .join(", ");
        throw new Error(
          `No Copilot model found. Available models: [${available || "none"}]. ` +
            "Make sure GitHub Copilot is installed and you've signed in.",
        );
      }
      const cts = new vscode.CancellationTokenSource();
      try {
        const response = await models[0].sendRequest(
          [vscode.LanguageModelChatMessage.User(prompt)],
          {},
          cts.token,
        );
        let text = "";
        for await (const chunk of response.text) text += chunk;
        return text.trim();
      } finally {
        cts.dispose();
      }
    },
  });
}
