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

  // The root entry point loads every module it imports, directly or through
  // other modules. So loading it must never load an AWS SDK client.
  describe.each(clients)("without %s installed", (client) => {
    async function load(path: string): Promise<unknown> {
      let loaded: unknown;
      await jest.isolateModulesAsync(async () => {
        jest.doMock(client, () => {
          throw new Error(`Cannot find module '${client}'`);
        });
        loaded = await import(path);
      });
      return loaded;
    }

    it("loads the package root", async () => {
      await expect(load("..")).resolves.toHaveProperty("ComputeError");
    });

    // The control: the mock does stop a module that imports the client.
    it("fails to load compute/microvm", async () => {
      await expect(load("../compute/microvm")).rejects.toThrow(
        `Cannot find module '${client}'`,
      );
    });
  });
});
