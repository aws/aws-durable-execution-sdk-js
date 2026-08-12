#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function usage() {
  console.error(
    "Usage: prepare-runtime-lock.mjs <source-lock> <sdk-package-json> <output-directory>",
  );
  process.exit(2);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveDependency(packages, parentPath, dependencyName) {
  let currentPath = parentPath;

  while (currentPath !== "") {
    const nestedPath = `${currentPath}/node_modules/${dependencyName}`;
    if (packages[nestedPath] != null) {
      return nestedPath;
    }

    const marker = currentPath.lastIndexOf("/node_modules/");
    currentPath = marker >= 0 ? currentPath.slice(0, marker) : "";
  }

  const rootPath = `node_modules/${dependencyName}`;
  if (packages[rootPath] != null) {
    return rootPath;
  }

  throw new Error(
    `Unable to resolve locked dependency '${dependencyName}' from '${parentPath}'.`,
  );
}

export function createRuntimePackageFiles(sourceLock, sdkPackage) {
  const packages = sourceLock.packages;
  if (packages == null || typeof packages !== "object") {
    throw new Error("The source lockfile does not contain a packages map.");
  }

  const sdkLockPath = Object.keys(packages).find(
    (packagePath) =>
      packagePath !== "" && packages[packagePath]?.name === sdkPackage.name,
  );
  if (sdkLockPath == null) {
    throw new Error(
      `Unable to find '${sdkPackage.name}' in the source lockfile.`,
    );
  }

  const runtimeDependencies = {};
  const rootPaths = [];
  for (const dependencyName of Object.keys(
    sdkPackage.dependencies ?? {},
  ).sort()) {
    const dependencyPath = resolveDependency(
      packages,
      sdkLockPath,
      dependencyName,
    );
    runtimeDependencies[dependencyName] = packages[dependencyPath].version;
    rootPaths.push(dependencyPath);
  }

  const selectedPackages = {};
  const pendingPaths = [...rootPaths].sort();
  while (pendingPaths.length > 0) {
    const packagePath = pendingPaths.shift();
    if (selectedPackages[packagePath] != null) {
      continue;
    }

    const packageEntry = packages[packagePath];
    if (packageEntry == null) {
      throw new Error(`Missing lockfile entry '${packagePath}'.`);
    }
    selectedPackages[packagePath] = packageEntry;

    const requiredNames = Object.keys(packageEntry.dependencies ?? {});
    const optionalNames = Object.keys(packageEntry.optionalDependencies ?? {});
    for (const dependencyName of [
      ...new Set([...requiredNames, ...optionalNames]),
    ].sort()) {
      try {
        const dependencyPath = resolveDependency(
          packages,
          packagePath,
          dependencyName,
        );
        if (selectedPackages[dependencyPath] == null) {
          pendingPaths.push(dependencyPath);
        }
      } catch (error) {
        if (!optionalNames.includes(dependencyName)) {
          throw error;
        }
      }
    }
    pendingPaths.sort();
  }

  const packageJson = {
    name: "aws-durable-execution-sdk-js-otel-layer-runtime",
    version: sdkPackage.version,
    private: true,
    dependencies: runtimeDependencies,
  };
  const orderedPackages = {
    "": {
      name: packageJson.name,
      version: packageJson.version,
      dependencies: runtimeDependencies,
    },
  };
  for (const packagePath of Object.keys(selectedPackages).sort()) {
    orderedPackages[packagePath] = selectedPackages[packagePath];
  }

  const packageLock = {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: sourceLock.lockfileVersion,
    requires: true,
    packages: orderedPackages,
  };

  return { packageJson, packageLock };
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) {
    usage();
  }

  const [, , sourceLockPath, sdkPackagePath, outputDirectory] = process.argv;
  const result = createRuntimePackageFiles(
    readJson(sourceLockPath),
    readJson(sdkPackagePath),
  );

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, "package.json"),
    `${JSON.stringify(result.packageJson, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDirectory, "package-lock.json"),
    `${JSON.stringify(result.packageLock, null, 2)}\n`,
  );
}
