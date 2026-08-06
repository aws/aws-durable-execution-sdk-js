/**
 * The desktop settings store.
 *
 * Two properties here are load-bearing and neither is obvious from reading the
 * happy path:
 *
 *   The merge is an allowlist, so a renderer payload cannot introduce arbitrary
 *   keys — including inherited names like `__proto__`, which on a plain object
 *   merge would corrupt the prototype rather than store a setting.
 *
 *   Reads tolerate a corrupt or hand-edited file. Falling back to defaults is
 *   recoverable; refusing to launch is not.
 *
 * `electron` is mocked because this module only needs `app.getPath("userData")`
 * from it, and requiring the real thing would pull in the whole runtime.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let userDataDir = "";

jest.mock("electron", () => ({
  app: { getPath: () => userDataDir },
}));

// Imported after the mock so the module picks it up.
import {
  readDesktopConfig,
  readDesktopFavorites,
  writeDesktopFavorites,
  writeDesktopSettings,
} from "./settings";

const SETTINGS_FILE = "insight-settings.json";

function storedSettings(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(userDataDir, SETTINGS_FILE), "utf-8"),
  ) as Record<string, unknown>;
}

function writeRaw(name: string, contents: string): void {
  writeFileSync(join(userDataDir, name), contents, "utf-8");
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), "insight-settings-"));
  // The corrupt-file cases warn by design; keep the suite output readable.
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  rmSync(userDataDir, { recursive: true, force: true });
});

describe("writeDesktopSettings", () => {
  it("persists recognized keys", () => {
    writeDesktopSettings({ region: "eu-west-1", athenaTable: "t" });
    expect(storedSettings()).toEqual({ region: "eu-west-1", athenaTable: "t" });
  });

  it("merges rather than replacing, so untouched keys survive", () => {
    // The renderer sends only the fields its Settings modal knows about, so a
    // wholesale write would silently drop everything else.
    writeDesktopSettings({ region: "eu-west-1", athenaDatabase: "db" });
    writeDesktopSettings({ region: "us-east-1" });
    expect(storedSettings()).toEqual({
      region: "us-east-1",
      athenaDatabase: "db",
    });
  });

  it("drops unrecognized keys instead of storing them", () => {
    writeDesktopSettings({
      region: "us-east-1",
      notASetting: "x",
    } as Record<string, string>);
    expect(storedSettings()).toEqual({ region: "us-east-1" });
  });

  it("refuses inherited property names reaching the allowlist", () => {
    // `constructor` and `toString` are what actually exercise the loop: in an
    // object literal they are ordinary own properties, so the allowlist is the
    // only thing stopping them from being persisted as settings.
    //
    // `__proto__` is deliberately NOT tested here. In a literal with a string
    // value it is neither a prototype assignment nor an own property —
    // Object.keys({ __proto__: "x" }) is [] — so it never reaches the loop and
    // an assertion about it could not fail. Its realistic shape is a parsed
    // settings file, covered in the readDesktopConfig suite below.
    writeDesktopSettings({
      constructor: "polluted",
      toString: "polluted",
      region: "us-east-1",
    } as unknown as Record<string, string>);
    expect(storedSettings()).toEqual({ region: "us-east-1" });
    expect({}.toString).toBeInstanceOf(Function);
  });

  it("removes a key when the value is undefined, restoring the default", () => {
    writeDesktopSettings({ athenaTable: "custom" });
    expect(readDesktopConfig().athenaTable).toBe("custom");
    writeDesktopSettings({ athenaTable: undefined });
    expect(storedSettings()).toEqual({});
    // configCore's default applies again.
    expect(readDesktopConfig().athenaTable).toBe("workflow_insight");
  });

  it("keeps false, which is a meaningful value and not 'unset'", () => {
    writeDesktopSettings({ sqsDeleteAfterRead: false });
    expect(storedSettings()).toEqual({ sqsDeleteAfterRead: false });
    expect(readDesktopConfig().sqsDeleteAfterRead).toBe(false);
  });
});

describe("readDesktopConfig", () => {
  it("applies configCore's defaults when nothing is stored", () => {
    const cfg = readDesktopConfig();
    expect(cfg.destinationType).toBe("cloudwatch-logs-exporter");
    expect(cfg.athenaTable).toBe("workflow_insight");
    expect(cfg.agenticMaxIterations).toBe(8);
  });

  it("normalizes stored values the same way the extension does", () => {
    writeDesktopSettings({
      logGroupName: "/a, /b ,/c",
      agenticMaxIterations: 99,
    });
    const cfg = readDesktopConfig();
    expect(cfg.logGroupNames).toEqual(["/a", "/b", "/c"]);
    // Clamped to the same [1, 20] range as in VS Code.
    expect(cfg.agenticMaxIterations).toBe(20);
  });

  it("coerces values written as strings", () => {
    // A hand-edited file may quote a boolean or number.
    writeRaw(
      SETTINGS_FILE,
      JSON.stringify({ sqsDeleteAfterRead: "true", agenticMaxIterations: "3" }),
    );
    const cfg = readDesktopConfig();
    expect(cfg.sqsDeleteAfterRead).toBe(true);
    expect(cfg.agenticMaxIterations).toBe(3);
  });

  it("ignores a __proto__ key in the settings file", () => {
    // The path that actually produces __proto__ as an own property: JSON.parse
    // does create it (Object.keys(JSON.parse('{"__proto__":{}}')) is
    // ["__proto__"]), unlike an object literal, so this is the shape that
    // reaches loadSettings' allowlist.
    //
    // The value is a *string* on purpose. With an object value the scalar type
    // check in loadSettings rejects it first, so the allowlist is never
    // exercised and this test passes even with the allowlist deleted (verified).
    // A string makes the allowlist the only thing standing in the way.
    //
    // For the record this is defence in depth, not a live vulnerability:
    // loadSettings accumulates into Object.create(null) and the later merge
    // spreads (which *defines* rather than *sets*), so the key is inert either
    // way — it would just be persisted back as a meaningless entry.
    writeRaw(SETTINGS_FILE, '{"__proto__":"polluted","region":"us-east-1"}');

    expect(() => readDesktopConfig()).not.toThrow();
    expect(readDesktopConfig().region).toBe("us-east-1");

    // Nothing was grafted onto the prototype chain.
    expect(
      (Object.prototype as unknown as Record<string, unknown>).polluted,
    ).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);

    // And the key is dropped rather than carried forward on the next write.
    writeDesktopSettings({ athenaTable: "t" });
    const stored = storedSettings();
    expect(Object.keys(stored).sort()).toEqual(["athenaTable", "region"]);
    expect(Object.prototype.hasOwnProperty.call(stored, "__proto__")).toBe(
      false,
    );
  });

  it("ignores a non-scalar value in the settings file", () => {
    // The other half of loadSettings' filter: an object or array value is not a
    // setting, whatever its key.
    writeRaw(
      SETTINGS_FILE,
      '{"region":{"nested":true},"athenaTable":["a"],"athenaDatabase":"db"}',
    );
    expect(readDesktopConfig().athenaDatabase).toBe("db");
    // Both malformed entries fall back to their defaults.
    expect(readDesktopConfig().region).toBe("us-east-1");
    expect(readDesktopConfig().athenaTable).toBe("workflow_insight");
  });

  it("falls back to defaults for a corrupt file rather than throwing", () => {
    writeRaw(SETTINGS_FILE, "{ not json");
    expect(() => readDesktopConfig()).not.toThrow();
    expect(readDesktopConfig().destinationType).toBe(
      "cloudwatch-logs-exporter",
    );
  });

  it("ignores unrecognized keys already present in the file", () => {
    writeRaw(
      SETTINGS_FILE,
      JSON.stringify({ region: "us-west-2", removedSetting: "x" }),
    );
    expect(readDesktopConfig().region).toBe("us-west-2");
    // Writing back must not carry the stale key forward.
    writeDesktopSettings({ athenaTable: "t" });
    expect(storedSettings()).toEqual({ region: "us-west-2", athenaTable: "t" });
  });
});

describe("favorites", () => {
  it("round-trips saved queries", () => {
    const list = [
      { id: "1", label: "a", query: "SELECT 1", destinationType: "s3" },
    ];
    writeDesktopFavorites(list);
    expect(readDesktopFavorites()).toEqual(list);
  });

  it("returns an empty list when nothing is stored", () => {
    expect(readDesktopFavorites()).toEqual([]);
  });

  it("drops malformed entries instead of failing the whole list", () => {
    writeRaw(
      "insight-favorites.json",
      JSON.stringify([
        { id: "1", label: "ok", query: "q", destinationType: "s3" },
        { id: 2, label: "bad id type" },
        null,
        "nope",
      ]),
    );
    expect(readDesktopFavorites()).toEqual([
      { id: "1", label: "ok", query: "q", destinationType: "s3" },
    ]);
  });

  it("tolerates a corrupt favorites file", () => {
    writeRaw("insight-favorites.json", "[[[");
    expect(readDesktopFavorites()).toEqual([]);
  });
});
