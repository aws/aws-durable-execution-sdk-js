/**
 * Guards how the extension behaves in an untrusted workspace (Restricted Mode).
 *
 * THE FAILURE THIS PREVENTS:
 * VS Code applies a workspace's `.vscode/settings.json` even before the user
 * trusts the folder, unless the extension lists the setting in
 * `capabilities.untrustedWorkspaces.restrictedConfigurations`. With
 * `"supported": true` and no such list, a repository the user merely opened
 * could set `llmProvider: "local-server"` plus `localServerUrl` to its own
 * host, pre-fill `aiDisclosureAcceptedVersion` to skip the AI notice, and turn
 * on `sqsDeleteAfterRead`. The next Ask/Agent question then sent the user's
 * query results to that host.
 *
 * Every setting decides where the extension connects, which credentials it
 * uses, what it sends to an LLM, or whether it deletes data, so all of them are
 * restricted. A setting added to the manifest without being restricted fails
 * here.
 */
// biome-ignore lint/style/noCommonJs: reads the extension manifest at runtime. `resolveJsonModule` is not enabled for this package, so a static import would not type-check.
const manifest = require("../package.json") as {
  capabilities: {
    untrustedWorkspaces: {
      supported: boolean | "limited";
      description?: string;
      restrictedConfigurations?: string[];
    };
  };
  contributes: {
    configuration: {
      properties: Record<string, { scope?: string }>;
    };
  };
};

const trust = manifest.capabilities.untrustedWorkspaces;
const properties = manifest.contributes.configuration.properties;
const settingIds = Object.keys(properties);

describe("workspace trust", () => {
  it("declares limited support with a description", () => {
    // `true` would hand every workspace value to the extension in Restricted
    // Mode. VS Code requires a description whenever support is limited.
    expect(trust.supported).toBe("limited");
    expect(trust.description?.trim()).toBeTruthy();
  });

  it("restricts every contributed setting in untrusted workspaces", () => {
    // A passing-but-vacuous version of this test is the bug it exists to catch.
    expect(settingIds.length).toBeGreaterThan(0);
    expect([...(trust.restrictedConfigurations ?? [])].sort()).toEqual(
      [...settingIds].sort(),
    );
  });

  it("never reads AI consent from a workspace, trusted or not", () => {
    // Consent belongs to the user. Application scope means VS Code ignores the
    // value in any workspace or folder settings file, so a trusted repository
    // cannot accept the AI notice on the user's behalf either.
    expect(
      properties["durableExecutionTelemetry.aiDisclosureAcceptedVersion"]
        ?.scope,
    ).toBe("application");
  });
});
