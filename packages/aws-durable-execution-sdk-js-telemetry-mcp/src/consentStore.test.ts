import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
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
    const file = join(dir, "sub", "accepted.json");
    expect(await fileConsentStore(file).has("a")).toBe(false);
    await fileConsentStore(file).add("a");
    expect(await fileConsentStore(file).has("a")).toBe(true);
    expect(await fileConsentStore(file).has("b")).toBe(false);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf-8")).not.toContain("arn:");
  });

  it("treats a corrupt file as nothing remembered", async () => {
    const file = join(dir, "accepted.json");
    writeFileSync(file, "{not json");
    expect(await fileConsentStore(file).has("a")).toBe(false);
    await fileConsentStore(file).add("a");
    expect(await fileConsentStore(file).has("a")).toBe(true);
  });
});

describe("fileConsentStore hardening", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "consent-h-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("tightens an existing loose directory to 0700", async () => {
    const sub = join(dir, "d");
    mkdirSync(sub, { mode: 0o755 });
    chmodSync(sub, 0o755);
    await fileConsentStore(join(sub, "a.json")).add("k");
    expect(statSync(sub).mode & 0o777).toBe(0o700);
  });

  it("refuses to write through a symlinked directory", async () => {
    const target = join(dir, "target");
    mkdirSync(target);
    const link = join(dir, "link");
    symlinkSync(target, link);
    await expect(
      fileConsentStore(join(link, "a.json")).add("k"),
    ).rejects.toThrow(/not a directory/);
    expect(readdirSync(target)).toEqual([]);
  });

  it("uses a fresh temp name, so a planted symlink is never written through", async () => {
    const sub = join(dir, "d");
    mkdirSync(sub, { mode: 0o700 });
    const victim = join(dir, "victim");
    writeFileSync(victim, "keep");
    // The old predictable temp name.
    symlinkSync(victim, join(sub, `a.json.${process.pid}.tmp`));
    await fileConsentStore(join(sub, "a.json")).add("k");
    expect(readFileSync(victim, "utf-8")).toBe("keep");
    expect(await fileConsentStore(join(sub, "a.json")).has("k")).toBe(true);
  });
});
