// Test stub for `version.ts`. The real module reads `import.meta.url`
// at top level, which ts-jest cannot compile because Jest forces
// `module: commonjs`. Tests don't care whether the SDK was loaded
// from inside the Lambda runtime; they just need the two exported
// constants the rest of the SDK reads.

export const SDK_NAME = "aws-durable-execution-sdk-js";
export const SDK_VERSION = process.env.NPM_PACKAGE_VERSION || "0.0.0";
