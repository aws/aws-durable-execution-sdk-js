/**
 * Guards what the Settings form's Save action writes.
 *
 * The form is filled with the effective config. In VS Code that includes values
 * from a trusted folder's .vscode/settings.json, layered over the user's
 * settings. Save used to write every field to the user's settings, which copied
 * the folder's values there; from then on they applied in every folder,
 * untrusted ones included. These tests use a fake host with the same two layers.
 */
import { normalizeConfig, type TelemetryConfig } from "./configCore";
import { ExplorerSession } from "./explorerSession";
import type { HostPort, SettingValue } from "./hostPort";

type Store = Record<string, SettingValue>;

function layeredHost(user: Store, workspace: Store) {
  const posted: Record<string, unknown>[] = [];
  const writes: Store[] = [];
  const read = (k: string): SettingValue =>
    Object.hasOwn(workspace, k) ? workspace[k] : user[k];
  const host: HostPort = {
    post: (m) => posted.push(m),
    readConfig: (): TelemetryConfig =>
      normalizeConfig({
        getString: (k) => read(k) as string | undefined,
        getBool: (k) => read(k) as boolean | undefined,
        getNumber: (k) => read(k) as number | undefined,
      }),
    writeSettings: async (values) => {
      writes.push({ ...values });
      for (const [k, v] of Object.entries(values)) {
        if (v === undefined) delete user[k];
        else user[k] = v;
      }
    },
    saveFile: async () => undefined,
    showInfo: () => {},
    readFavorites: () => [],
    writeFavorites: async () => {},
  };
  return { host, posted, writes };
}

/** What the webview sends on Save: the last `config` it received, as strings. */
function formFrom(posted: Record<string, unknown>[]): Record<string, string> {
  const config = posted.filter((m) => m.type === "config").at(-1) as {
    settings: Record<string, unknown>;
  };
  return Object.fromEntries(
    Object.entries(config.settings).map(([k, v]) => [k, String(v)]),
  );
}

async function openSession(user: Store, workspace: Store) {
  const h = layeredHost(user, workspace);
  const session = new ExplorerSession(h.host);
  await session.dispatch({ type: "ready" });
  return { ...h, session };
}

const save = (session: ExplorerSession, settings: Record<string, string>) =>
  session.dispatch({ type: "saveSettings", settings });

describe("ExplorerSession saveSettings", () => {
  it("does not copy workspace values into user settings", async () => {
    const user: Store = { region: "us-west-2" };
    const workspace: Store = {
      localServerUrl: "http://repo.example/v1",
      sqsDeleteAfterRead: true,
      awsProfile: "repo-profile",
    };
    const { session, posted, writes } = await openSession(user, workspace);

    // The user changes one field and saves the rest untouched.
    await save(session, { ...formFrom(posted), queryMode: "query" });

    expect(writes).toEqual([{ queryMode: "query" }]);
    expect(user).toEqual({ region: "us-west-2", queryMode: "query" });
  });

  it("writes nothing when nothing changed", async () => {
    const user: Store = { region: "us-west-2", logGroupName: "/a,/b" };
    const { session, posted, writes } = await openSession(user, {});

    await save(session, formFrom(posted));

    expect(writes).toEqual([{}]);
    expect(user).toEqual({ region: "us-west-2", logGroupName: "/a,/b" });
  });

  it("still clears a field the user emptied", async () => {
    const user: Store = { awsProfile: "dev" };
    const { session, posted, writes } = await openSession(user, {});

    await save(session, { ...formFrom(posted), awsProfile: "" });

    expect(writes).toEqual([{ awsProfile: undefined }]);
    expect(user).toEqual({});
  });

  it("never records AI consent from the form", async () => {
    const user: Store = {};
    const { session, posted, writes } = await openSession(user, {});

    await save(session, {
      ...formFrom(posted),
      aiDisclosureAcceptedVersion: "2",
    });

    expect(writes).toEqual([{}]);
    expect(user).toEqual({});
  });

  it("warns when a workspace value hides the value just saved", async () => {
    const user: Store = {};
    const workspace: Store = { localServerUrl: "http://repo.example/v1" };
    const { session, posted } = await openSession(user, workspace);

    await save(session, {
      ...formFrom(posted),
      localServerUrl: "http://localhost:1234/v1",
    });

    expect(user.localServerUrl).toBe("http://localhost:1234/v1");
    const errors = posted.filter((m) => m.type === "error");
    expect(errors).toHaveLength(1);
    expect(String(errors[0].message)).toContain("overrides localServerUrl");
    expect(posted.at(-1)).toEqual({ type: "settingsSaved" });
  });

  it("does not warn when there is no workspace layer", async () => {
    const { session, posted } = await openSession({}, {});

    await save(session, {
      ...formFrom(posted),
      localServerUrl: "http://localhost:1234/v1",
      logGroupName: " /a ,/b ",
    });

    expect(posted.filter((m) => m.type === "error")).toEqual([]);
  });
});
