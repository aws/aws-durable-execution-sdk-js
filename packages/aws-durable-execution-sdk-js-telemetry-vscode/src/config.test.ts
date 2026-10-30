/**
 * Guards where readConfig takes AI consent from.
 *
 * Consent must come from the user's own settings only. A folder's
 * .vscode/settings.json, trusted or not, must not be able to accept the AI
 * notice for the user. Every other setting keeps VS Code's normal resolution.
 */
type Inspect = {
  defaultValue?: unknown;
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
};

let layers: Record<string, Inspect> = {};

/** VS Code's precedence: folder, then workspace, then user, then default. */
function effective(i: Inspect | undefined): unknown {
  return (
    i?.workspaceFolderValue ??
    i?.workspaceValue ??
    i?.globalValue ??
    i?.defaultValue
  );
}

jest.mock(
  "vscode",
  () => ({
    workspace: {
      getConfiguration: () => ({
        get: (k: string) => effective(layers[k]),
        inspect: (k: string) =>
          layers[k] ? { key: k, ...layers[k] } : undefined,
      }),
    },
  }),
  { virtual: true },
);

import { readConfig } from "./config";

describe("readConfig", () => {
  beforeEach(() => {
    layers = {};
  });

  it("ignores AI consent set by a workspace", () => {
    layers.aiDisclosureAcceptedVersion = {
      defaultValue: "",
      workspaceValue: "2",
    };
    expect(readConfig().aiDisclosureAcceptedVersion).toBe("");
  });

  it("ignores AI consent set by a workspace folder", () => {
    layers.aiDisclosureAcceptedVersion = {
      defaultValue: "",
      workspaceFolderValue: "2",
    };
    expect(readConfig().aiDisclosureAcceptedVersion).toBe("");
  });

  it("reads AI consent from user settings", () => {
    layers.aiDisclosureAcceptedVersion = {
      defaultValue: "",
      globalValue: "2",
      workspaceValue: "1",
    };
    expect(readConfig().aiDisclosureAcceptedVersion).toBe("2");
  });

  it("treats cleared user consent as withdrawn", () => {
    layers.aiDisclosureAcceptedVersion = { defaultValue: "" };
    expect(readConfig().aiDisclosureAcceptedVersion).toBe("");
  });

  it("resolves other settings normally, including workspace values", () => {
    // Restricted Mode hides untrusted workspace values before `get` returns,
    // so a workspace value that reaches here comes from a trusted folder.
    layers.localServerUrl = {
      defaultValue: "http://localhost:11434/v1",
      globalValue: "http://localhost:1234/v1",
      workspaceValue: "http://team.example/v1",
    };
    expect(readConfig().localServerUrl).toBe("http://team.example/v1");
  });
});
