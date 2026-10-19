/**
 * The VS Code binding for Durable Execution Telemetry's settings.
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
  type TelemetryConfig,
} from "@aws/durable-execution-sdk-js-telemetry-core";

export {
  SECTION,
  normalizeConfig,
  configFromWireSettings,
  resolveCredentials,
  type TelemetryConfig,
  type ConfigSource,
} from "@aws/durable-execution-sdk-js-telemetry-core";

/** Read the user's persisted VS Code settings as an {@link TelemetryConfig}. */
export function readConfig(): TelemetryConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  return normalizeConfig({
    getString: (k) => c.get<string>(k),
    getBool: (k) => c.get<boolean>(k),
    getNumber: (k) => c.get<number>(k),
  });
}
