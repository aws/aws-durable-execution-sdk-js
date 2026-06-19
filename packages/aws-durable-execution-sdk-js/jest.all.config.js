/** @type {import('jest').Config} */
// The dedicated "scripts" test project was removed when `src/scripts/` was
// deleted during the esbuild -> rollup migration (#38); the script tooling
// that remains lives in `scripts/` and has no TypeScript tests. As a result
// the only test suite is the library suite defined in `jest.config.js`, so
// `test:all` re-exports it to stay in sync and avoid config drift (e.g. the
// `version.ts` `import.meta` handling that this file previously lacked).
module.exports = require("./jest.config.js");
