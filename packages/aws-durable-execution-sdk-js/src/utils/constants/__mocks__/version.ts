// Stub for `version.ts`. The real module reads `import.meta.url` at
// top level, which cannot compile as CommonJS (TS1343). This SDK's own
// Vitest suite uses the real module; the stub is kept because
// `aws-durable-execution-sdk-js-examples/scripts/copy-sdk-source.js`
// substitutes it into its coverage copy of the SDK source. Callers only
// need the two exported constants the rest of the SDK reads.

export const SDK_NAME = "aws-durable-execution-sdk-js";
export const SDK_VERSION = process.env.NPM_PACKAGE_VERSION || "0.0.0";
