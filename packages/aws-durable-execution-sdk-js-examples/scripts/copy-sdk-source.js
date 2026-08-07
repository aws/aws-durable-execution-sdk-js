const fs = require("fs");
const path = require("path");

const sdkSourcePath = path.resolve(
  __dirname,
  "../../aws-durable-execution-sdk-js/src",
);
const targetPath = path.resolve(__dirname, "../src/dur-sdk");

if (fs.existsSync(targetPath)) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

fs.cpSync(sdkSourcePath, targetPath, { recursive: true });

// `utils/constants/version.ts` reads `import.meta.url` at top level. ts-jest
// compiles with `module: commonjs`, where that is a hard error (TS1343), so
// every suite that transitively imports the SDK fails to compile. The SDK's own
// unit tests avoid this via the manual mock at
// `utils/constants/__mocks__/version.ts`; do the same here by substituting the
// stub for the real module in the copied tree. Only the UserAgent version
// string differs, which no example asserts on.
const versionMockPath = path.join(
  targetPath,
  "utils/constants/__mocks__/version.ts",
);
const versionPath = path.join(targetPath, "utils/constants/version.ts");

if (fs.existsSync(versionMockPath)) {
  fs.copyFileSync(versionMockPath, versionPath);
  console.log("✓ Substituted version.ts with its ts-jest-safe stub");
} else {
  console.warn(
    `⚠ Expected version mock at ${versionMockPath} was not found; ` +
      "coverage run may fail with TS1343.",
  );
}

console.log(`✓ Copied SDK source to ${targetPath}`);
