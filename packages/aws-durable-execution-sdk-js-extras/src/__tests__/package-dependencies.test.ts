import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"),
) as PackageJson;

/**
 * Each AWS SDK client, and the subpath module that imports it. A new client
 * needs an entry here, so the test below knows which subpath needs it.
 */
const CLIENT_SUBPATHS: Readonly<Record<string, string>> = {
  "@aws-sdk/client-lambda-microvms": "../compute/microvm",
};

describe("package dependencies", () => {
  // A customer installs only the clients of the subpaths they import. So no
  // client can be a dependency that npm installs for every customer.
  it("has no runtime dependencies", () => {
    expect(packageJson.dependencies ?? {}).toEqual({});
  });

  const clients = Object.keys(packageJson.peerDependencies ?? {}).filter(
    (name) => name.startsWith("@aws-sdk/"),
  );

  it("names the subpath of every AWS SDK client", () => {
    expect(clients.length).toBeGreaterThan(0);
    expect(Object.keys(CLIENT_SUBPATHS).sort()).toEqual([...clients].sort());
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
  describe.each(Object.entries(CLIENT_SUBPATHS))(
    "without %s installed",
    (client, subpath) => {
      async function load(path: string): Promise<unknown> {
        vi.resetModules();
        vi.doMock(client, () => {
          throw new Error(`Cannot find module '${client}'`);
        });
        try {
          return await import(path);
        } finally {
          vi.doUnmock(client);
          vi.resetModules();
        }
      }

      it("loads the package root", async () => {
        await expect(load("..")).resolves.toHaveProperty("ComputeError");
      });

      // The control: the mock does stop the subpath that imports this client.
      it(`fails to load ${subpath}`, async () => {
        // Vitest wraps an error that a mock factory throws, and keeps it
        // as the cause.
        const error = await load(subpath).then(
          () => undefined,
          (thrown: unknown) => thrown as Error,
        );
        expect((error?.cause as Error | undefined)?.message).toBe(
          `Cannot find module '${client}'`,
        );
      });
    },
  );
});
