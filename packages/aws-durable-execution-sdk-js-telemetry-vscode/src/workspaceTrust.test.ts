/**
 * Guards how the extension behaves in an untrusted workspace (Restricted Mode).
 *
 * VS Code applies a folder's `.vscode/settings.json` before the user trusts it,
 * unless the extension lists the setting in
 * `capabilities.untrustedWorkspaces.restrictedConfigurations`. Several settings
 * decide where the extension connects, which credentials it uses, where it
 * sends data for the AI features, or whether it deletes SQS messages.
 * Restricting every setting is simpler and safer than auditing each one, so a
 * setting added to the manifest without being restricted fails here.
 *
 * AI consent has a stricter rule, enforced in config.ts and tested in
 * config.test.ts: it is read from user settings only, even in a trusted folder.
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
    // Mode. VS Code shows the description to users in Restricted Mode.
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

  it("keeps AI consent in the user's own profile", () => {
    // Application scope would move the value to the default profile and leave
    // an old value behind in the user's profile, so clearing it would no
    // longer withdraw consent there. config.ts enforces user-only instead.
    expect(
      properties["durableExecutionTelemetry.aiDisclosureAcceptedVersion"]
        ?.scope,
    ).toBeUndefined();
  });
});
