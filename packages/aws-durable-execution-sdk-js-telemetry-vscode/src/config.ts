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

/**
 * Settings read only from the user's own settings, never from a workspace or
 * folder settings file, even a trusted one.
 *
 * AI consent belongs to the user, so a repository must not be able to record
 * it. This is enforced here rather than with `"scope": "application"` in the
 * manifest: application scope moves the value to the default profile, which
 * leaves an old value behind in the user's own profile and stops "clear to
 * withdraw" from working there. `globalValue` is the current profile's user
 * value, which is exactly where `writeSettings` writes it.
 */
const USER_ONLY_KEYS: ReadonlySet<string> = new Set([
  "aiDisclosureAcceptedVersion",
]);

/** Read the user's persisted VS Code settings as an {@link TelemetryConfig}. */
export function readConfig(): TelemetryConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  return normalizeConfig({
    getString: (k) =>
      USER_ONLY_KEYS.has(k)
        ? c.inspect<string>(k)?.globalValue
        : c.get<string>(k),
    getBool: (k) => c.get<boolean>(k),
    getNumber: (k) => c.get<number>(k),
  });
}
