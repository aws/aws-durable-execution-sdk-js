// Type entry for the "import" condition. A .d.mts file is always ESM, so an
// ESM import under node16 or nodenext gets ESM types. tsc writes only .d.ts
// files, which TypeScript reads as CommonJS in a package with no "type" field.
export * from "./dist-types/index.js";
