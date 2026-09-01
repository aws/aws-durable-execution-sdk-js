import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimePackageFiles } from "./prepare-runtime-lock.mjs";

test("extracts the locked runtime dependency closure", () => {
  const sourceLock = {
    lockfileVersion: 3,
    packages: {
      "": {
        name: "workspace",
        workspaces: ["packages/*"],
      },
      "packages/sdk": {
        name: "@example/sdk",
        version: "1.0.0",
        dependencies: {
          alpha: "^1.0.0",
        },
      },
      "node_modules/alpha": {
        version: "1.2.3",
        dependencies: {
          shared: "^2.0.0",
        },
        optionalDependencies: {
          unavailable: "^1.0.0",
        },
      },
      "node_modules/alpha/node_modules/shared": {
        version: "2.1.0",
      },
      "node_modules/shared": {
        version: "1.5.0",
      },
      "node_modules/unrelated": {
        version: "9.0.0",
      },
    },
  };
  const sdkPackage = {
    name: "@example/sdk",
    version: "1.0.0",
    dependencies: {
      alpha: "^1.0.0",
    },
  };

  const { packageJson, packageLock } = createRuntimePackageFiles(
    sourceLock,
    sdkPackage,
  );

  assert.deepEqual(packageJson.dependencies, { alpha: "1.2.3" });
  assert.deepEqual(Object.keys(packageLock.packages), [
    "",
    "node_modules/alpha",
    "node_modules/alpha/node_modules/shared",
  ]);
  assert.equal(
    packageLock.packages["node_modules/alpha/node_modules/shared"].version,
    "2.1.0",
  );
});

test("fails when the SDK is absent from the source lockfile", () => {
  assert.throws(
    () =>
      createRuntimePackageFiles(
        { lockfileVersion: 3, packages: { "": {} } },
        { name: "@example/sdk", version: "1.0.0" },
      ),
    /Unable to find '@example\/sdk'/,
  );
});
