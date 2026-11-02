import { readFileSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"),
) as PackageJson;

const root = readFileSync(join(__dirname, "..", "index.ts"), "utf8");

describe("package dependencies", () => {
  // A customer installs only the clients of the subpaths they import. So no
  // client can be a dependency that npm installs for every customer.
  it("has no runtime dependencies", () => {
    expect(packageJson.dependencies ?? {}).toEqual({});
  });

  const clients = Object.keys(packageJson.peerDependencies ?? {}).filter(
    (name) => name.startsWith("@aws-sdk/"),
  );

  it("declares at least one AWS SDK client", () => {
    expect(clients.length).toBeGreaterThan(0);
  });

  it.each(clients)("declares %s as an optional peer dependency", (name) => {
    expect(packageJson.peerDependenciesMeta?.[name]?.optional).toBe(true);
    // The tests need the client.
    expect(packageJson.devDependencies?.[name]).toBe(
      packageJson.peerDependencies?.[name],
    );
  });

  // The root entry point loads every module it re-exports, and every client
  // those modules import. So it re-exports only modules that import no client.
  it("re-exports only the shared compute module from the root", () => {
    const reExports = [...root.matchAll(/from "([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(reExports).toEqual(["./compute"]);
  });
});
