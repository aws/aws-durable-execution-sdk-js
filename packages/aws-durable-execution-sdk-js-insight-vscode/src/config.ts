/**
 * VS Code configuration adapter. The config *logic* (shape, normalization,
 * webview-settings mapping, credential resolution) lives in the vscode-free
 * `configCore` so non-VS-Code hosts can reuse it; this module only adds
 * `readConfig`, which reads the persisted VS Code workspace settings.
 */
import * as vscode from "vscode";
import { normalizeConfig, type InsightConfig } from "./configCore";

export * from "./configCore";

const SECTION = "workflowInsight";

export function readConfig(): InsightConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  return normalizeConfig({
    getString: (k) => c.get<string>(k),
    getBool: (k) => c.get<boolean>(k),
    getNumber: (k) => c.get<number>(k),
  });
}
