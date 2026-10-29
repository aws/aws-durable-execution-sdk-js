import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfigFromEnv } from "./config";
import { consentKey, fileConsentStore } from "./consentStore";

const base = {
  DURABLE_TELEMETRY_DESTINATION_TYPE: "aurora",
  DURABLE_TELEMETRY_AURORA_RESOURCE_ARN: "arn:aws:rds:us-east-1:1:cluster:c",
  DURABLE_TELEMETRY_AURORA_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:1:secret:s",
  DURABLE_TELEMETRY_REGION: "us-east-1",
};
const cfg = (extra: Record<string, string> = {}) =>
  readConfigFromEnv({ ...base, ...extra }).config;

/** A valid key: 64 hex characters, like a real consentKey. */
const key = (n: number | string) => String(n).padStart(64, "0");

describe("consentKey", () => {
  it("changes with the profile or destination", () => {
    const k = consentKey(cfg());
    expect(consentKey(cfg())).toBe(k);
    expect(
      consentKey(
        cfg({
          DURABLE_TELEMETRY_AURORA_SECRET_ARN:
            "arn:aws:secretsmanager:us-east-1:1:secret:other",
        }),
      ),
    ).not.toBe(k);
    expect(consentKey(cfg({ AWS_PROFILE: "other" }))).not.toBe(k);
    expect(consentKey(cfg({ DURABLE_TELEMETRY_AURORA_TABLE: "t2" }))).not.toBe(
      k,
    );
  });

  it("stores no setting in plain text", () => {
    expect(consentKey(cfg())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("fileConsentStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "consent-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("remembers a key across store instances, in a private file", async () => {
    const store = join(dir, "home", "accepted");
    const k = consentKey(cfg());
    expect(await fileConsentStore(store).has(k)).toBe(false);
    await fileConsentStore(store).add(k);
    expect(await fileConsentStore(store).has(k)).toBe(true);
    expect(await fileConsentStore(store).has(key(1))).toBe(false);
    expect(readdirSync(store)).toEqual([k]);
    expect(statSync(join(store, k)).mode & 0o777).toBe(0o600);
    expect(statSync(store).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(store, k), "utf-8")).toBe("");
  });

  it("saving the same key twice is not an error", async () => {
    const store = join(dir, "s");
    await fileConsentStore(store).add(key(1));
    await fileConsentStore(store).add(key(1));
    expect(readdirSync(store)).toEqual([key(1)]);
  });

  it("rejects a key that is not a hash, so it cannot name another path", async () => {
    const store = join(dir, "s");
    await expect(fileConsentStore(store).add("../x")).rejects.toThrow(
      /Invalid consent key/,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it("keeps the newest 200 keys", async () => {
    const store = join(dir, "s");
    mkdirSync(store, { mode: 0o700 });
    // 200 existing keys, oldest first.
    for (let i = 0; i < 200; i++) {
      const p = join(store, key(i));
      writeFileSync(p, "");
      const t = new Date(Date.now() - (300 - i) * 1000);
      utimesSync(p, t, t);
    }
    await fileConsentStore(store).add(key("f"));
    const left = readdirSync(store);
    expect(left).toHaveLength(200);
    expect(left).toContain(key("f"));
    expect(left).not.toContain(key(0));
    expect(left).toContain(key(1));
  });
});

describe("fileConsentStore hardening", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "consent-h-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("tightens existing loose directories to 0700", async () => {
    const parent = join(dir, "d");
    const store = join(parent, "accepted");
    mkdirSync(store, { recursive: true, mode: 0o755 });
    chmodSync(parent, 0o755);
    chmodSync(store, 0o755);
    await fileConsentStore(store).add(key(1));
    expect(statSync(parent).mode & 0o777).toBe(0o700);
    expect(statSync(store).mode & 0o777).toBe(0o700);
  });

  it.each([
    ["the store directory", (d: string) => join(d, "link")],
    ["its parent", (d: string) => join(d, "link", "accepted")],
  ])("refuses to write through a symlinked %s", async (_name, storeIn) => {
    const target = join(dir, "target");
    mkdirSync(target);
    symlinkSync(target, join(dir, "link"));
    await expect(fileConsentStore(storeIn(dir)).add(key(1))).rejects.toThrow(
      /not a directory/,
    );
    expect(readdirSync(target)).toEqual([]);
  });

  it("never writes through a symlink planted under a key's name", async () => {
    const store = join(dir, "s");
    mkdirSync(store, { mode: 0o700 });
    const victim = join(dir, "victim");
    writeFileSync(victim, "keep");
    symlinkSync(victim, join(store, key(1)));
    expect(await fileConsentStore(store).has(key(1))).toBe(false);
    await expect(fileConsentStore(store).add(key(1))).rejects.toThrow(
      /not a regular file/,
    );
    expect(readFileSync(victim, "utf-8")).toBe("keep");
  });

  it("fails at once when a directory sits under a key's name", async () => {
    const store = join(dir, "s");
    mkdirSync(join(store, key(1)), { recursive: true });
    const started = Date.now();
    await expect(fileConsentStore(store).add(key(1))).rejects.toThrow(
      /not a regular file/,
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await fileConsentStore(store).has(key(1))).toBe(false);
  });
});

describe("fileConsentStore concurrency", () => {
  it("keeps every key when separate processes save at once", async () => {
    const { spawn } = await import("node:child_process");
    const dir = mkdtempSync(join(tmpdir(), "consent-c-"));
    const store = join(dir, "accepted");
    // Each child imports the store fresh and adds its own key, as a separate
    // MCP server session would.
    const script = `
      const { fileConsentStore } = require(${JSON.stringify(join(__dirname, "consentStore.ts"))});
      fileConsentStore(process.argv[1]).add(process.argv[2]).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
    `;
    try {
      const codes = await Promise.all(
        Array.from(
          { length: 8 },
          (_, i) =>
            new Promise<number>((resolve) => {
              const child = spawn(
                process.execPath,
                ["--import", "tsx", "-e", script, store, key(i)],
                { stdio: "inherit" },
              );
              child.on("exit", (code) => resolve(code ?? 1));
            }),
        ),
      );
      expect(codes).toEqual(Array(8).fill(0));
      for (let i = 0; i < 8; i++) {
        expect(await fileConsentStore(store).has(key(i))).toBe(true);
      }
      expect(readdirSync(store)).toHaveLength(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
