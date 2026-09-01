/**
 * Guards the settings contract shared by the two hosts.
 *
 * settingsKeys.ts exists so the desktop app can validate and coerce settings
 * without a VS Code manifest. That only holds while the list actually matches
 * `contributes.configuration`, so this suite compares them structurally — a
 * setting added to package.json without updating settingsKeys.ts (or vice
 * versa) fails here rather than silently becoming unsettable in the desktop
 * app.
 */
import {
  BOOLEAN_SETTING_KEYS,
  NUMBER_SETTING_KEYS,
  SETTING_KEYS,
  isSettingKey,
} from "@aws/durable-execution-sdk-js-insight-core";
const manifest = require("../package.json") as {
  contributes: {
    configuration: {
      properties: Record<string, { type: string }>;
    };
  };
};

const SECTION = "workflowInsight";

/** The manifest's keys, unprefixed, in declaration order. */
const manifestEntries = Object.entries(
  manifest.contributes.configuration.properties,
).map(([key, prop]) => {
  expect(key.startsWith(`${SECTION}.`)).toBe(true);
  return [key.slice(SECTION.length + 1), prop.type] as const;
});

describe("settingsKeys", () => {
  it("lists exactly the keys the extension manifest contributes", () => {
    // A passing-but-vacuous version of this test is the bug it exists to catch.
    expect(manifestEntries.length).toBeGreaterThan(0);
    expect([...SETTING_KEYS]).toEqual(manifestEntries.map(([k]) => k));
  });

  it("classifies boolean and number keys the way the manifest types them", () => {
    expect([...BOOLEAN_SETTING_KEYS]).toEqual(
      manifestEntries.filter(([, t]) => t === "boolean").map(([k]) => k),
    );
    expect([...NUMBER_SETTING_KEYS]).toEqual(
      manifestEntries.filter(([, t]) => t === "number").map(([k]) => k),
    );
  });

  it("only claims types the hosts know how to coerce", () => {
    // string / boolean / number are the three a host must handle. Anything else
    // in the manifest would be silently mishandled by the desktop coercion.
    expect([...new Set(manifestEntries.map(([, t]) => t))].sort()).toEqual([
      "boolean",
      "number",
      "string",
    ]);
  });

  it("recognizes known keys and rejects everything else", () => {
    for (const key of SETTING_KEYS) expect(isSettingKey(key)).toBe(true);
    expect(isSettingKey("region")).toBe(true);
    expect(isSettingKey("__proto__")).toBe(false);
    expect(isSettingKey("constructor")).toBe(false);
    expect(isSettingKey("notASetting")).toBe(false);
    expect(isSettingKey("")).toBe(false);
  });
});
