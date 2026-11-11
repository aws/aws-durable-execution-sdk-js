// Writes dist-types/index.d.mts, the type entry for the "import" condition.
//
// tsc emits .d.ts files. The package has no "type" field, so TypeScript reads
// a .d.ts file as CommonJS. An ESM import under node16 or nodenext then gets
// CommonJS types for an ESM file. A .d.mts file is always ESM, so this entry
// gives an ESM import ESM types. It re-exports the same declarations.
import { writeFileSync } from "node:fs";

writeFileSync("dist-types/index.d.mts", 'export * from "./index.js";\n');
