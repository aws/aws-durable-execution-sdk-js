import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { contentTypeFor, resolveAssetPath } from "./assetPath";

const ROOT = resolve("/tmp/insight-media");

describe("resolveAssetPath", () => {
  it("resolves ordinary asset paths inside the root", () => {
    expect(resolveAssetPath(ROOT, "/webview.js")).toBe(
      `${ROOT}${sep}webview.js`,
    );
    expect(resolveAssetPath(ROOT, "/nested/dir/font.woff2")).toBe(
      `${ROOT}${sep}nested${sep}dir${sep}font.woff2`,
    );
  });

  it("allows the root itself", () => {
    expect(resolveAssetPath(ROOT, "/")).toBe(ROOT);
  });

  it.each([
    ["parent traversal", "/../secret.txt"],
    ["nested traversal", "/assets/../../secret.txt"],
    ["deep traversal", "/../../../../etc/passwd"],
    ["traversal to absolute", "/../../../../../../etc/shadow"],
    ["bare dotdot", "/.."],
  ])("rejects %s", (_label, pathname) => {
    expect(resolveAssetPath(ROOT, pathname)).toBeNull();
  });

  it("rejects a sibling directory that merely shares the root's prefix", () => {
    // The reason the boundary check appends a separator: startsWith(ROOT) alone
    // would accept this.
    expect(resolveAssetPath(ROOT, "/../insight-media-evil/x.js")).toBeNull();
  });

  it("rejects an embedded NUL byte", () => {
    expect(resolveAssetPath(ROOT, "/webview.js\0.png")).toBeNull();
  });

  it("contains an already-decoded traversal sequence", () => {
    // protocol.handle gives us a decoded pathname, so %2e%2e%2f arrives as
    // "../" — the case this guard has to catch.
    expect(
      resolveAssetPath(ROOT, "/" + decodeURIComponent("%2e%2e%2f") + "x"),
    ).toBeNull();
  });

  it("normalizes redundant separators without escaping", () => {
    expect(resolveAssetPath(ROOT, "//webview.js")).toBe(
      `${ROOT}${sep}webview.js`,
    );
    expect(resolveAssetPath(ROOT, "/./webview.js")).toBe(
      `${ROOT}${sep}webview.js`,
    );
  });

  describe("with real directories on disk", () => {
    let root: string;
    let outside: string;

    beforeEach(() => {
      const base = realpathSync(mkdtempSync(join(tmpdir(), "insight-assets-")));
      root = join(base, "media");
      outside = join(base, "secrets");
      mkdirSync(root);
      mkdirSync(outside);
      writeFileSync(join(root, "webview.js"), "// asset");
      writeFileSync(join(outside, "creds"), "sensitive");
    });

    afterEach(() => {
      rmSync(dirname(root), { recursive: true, force: true });
    });

    it("serves a real file inside the root", () => {
      expect(resolveAssetPath(root, "/webview.js")).toBe(
        join(root, "webview.js"),
      );
    });

    it("rejects a symlink pointing outside the root", () => {
      // The lexical check passes here — "escape/creds" contains no ".." — so
      // only the realpath comparison can catch this.
      symlinkSync(outside, join(root, "escape"));
      expect(resolveAssetPath(root, "/escape/creds")).toBeNull();
    });

    it("rejects a symlinked file pointing outside the root", () => {
      symlinkSync(join(outside, "creds"), join(root, "innocent.js"));
      expect(resolveAssetPath(root, "/innocent.js")).toBeNull();
    });

    it("allows a symlink that stays inside the root", () => {
      mkdirSync(join(root, "sub"));
      writeFileSync(join(root, "sub", "real.js"), "// ok");
      symlinkSync(join(root, "sub"), join(root, "linked"));
      expect(resolveAssetPath(root, "/linked/real.js")).toBe(
        join(root, "linked", "real.js"),
      );
    });

    it("still resolves a path that does not exist yet", () => {
      // realpathSync throws for a missing path; the lexical result must stand so
      // the caller's own existence check produces the 404.
      expect(resolveAssetPath(root, "/missing.js")).toBe(
        join(root, "missing.js"),
      );
    });
  });
});

describe("contentTypeFor", () => {
  it("maps the bundle's asset types", () => {
    expect(contentTypeFor("/a/webview.js")).toBe("text/javascript");
    expect(contentTypeFor("/a/webview.css")).toBe("text/css");
    expect(contentTypeFor("/a/f.woff2")).toBe("font/woff2");
    expect(contentTypeFor("/a/i.png")).toBe("image/png");
    expect(contentTypeFor("/a/m.wasm")).toBe("application/wasm");
  });

  it("is case-insensitive on the extension", () => {
    expect(contentTypeFor("/a/I.PNG")).toBe("image/png");
  });

  it("falls back to a generic type", () => {
    expect(contentTypeFor("/a/thing.unknown")).toBe("application/octet-stream");
    expect(contentTypeFor("/a/noextension")).toBe("application/octet-stream");
  });
});
