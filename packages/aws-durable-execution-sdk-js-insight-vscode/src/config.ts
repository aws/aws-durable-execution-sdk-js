/**
 * The VS Code binding for Workflow Insight's settings.
 *
 * Everything about what a setting *means* — its default, its coercion, its
 * clamping — lives in configCore.ts, which imports no `vscode` so the desktop
 * host can share it. This file adds only the one thing that is genuinely VS
 * Code specific: reading the values out of `vscode.workspace.getConfiguration`.
 *
 * The re-exports below keep `./config` a drop-in import for existing callers.
 */
import * as vscode from "vscode";
import {
  SECTION,
  normalizeConfig,
  type InsightConfig,
} from "@aws/durable-execution-sdk-js-insight-core";

export {
  SECTION,
  normalizeConfig,
  configFromWireSettings,
  resolveCredentials,
  type InsightConfig,
  type ConfigSource,
} from "@aws/durable-execution-sdk-js-insight-core";

/** Read the user's persisted VS Code settings as an {@link InsightConfig}. */
export function readConfig(): InsightConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  return normalizeConfig({
    getString: (k) => c.get<string>(k),
    getBool: (k) => c.get<boolean>(k),
    getNumber: (k) => c.get<number>(k),
  });
}
