# DurableExecutionsTypeScriptTestingLibrary - `@amzn/durable-executions-type-script-testing-library`

The NPM package name should always start with `@amzn/` to cleanly separate from
public packages, avoid accidental publish to public repository, and allow
publishing to CodeArtifact.

The package is built with
[NpmPrettyMuch](https://w.amazon.com/bin/view/NpmPrettyMuch/GettingStarted/v1)
and allows using internal (first-party) dependencies as well as external
npmjs.com packages.

Add registry dependencies with `brazil-build install` exactly the same as [`npm
install`](https://docs.npmjs.com/cli-commands/install.html). You can check
latest state of external dependencies on https://npmpm.corp.amazon.com/
Important: always use `brazil-build` wrapper for npm, using `npm` directly will
use the public registry instead of the internal registry.

Add brazil packages that build npm packages to the `dependencies` or
`test-dependencies` sections in the Config file,  then add a `*` dependency or
devDependencies to package.json. You should match `test-dependencies` with
`devDependencies`, and normal `dependencies` with `dependencies`.

NpmPrettyMuch 1.1 has special behavior for running tests during build. The
option `"runTest": "never"` disabled this and instead tests are wired up in
`prepublishOnly`. NpmPrettyMuch will invoke `prepublishOnly` and everything can
configured in there the [same as with external
npm](https://docs.npmjs.com/misc/scripts). Files to published are configured
using [`files` in
`package.json`](https://docs.npmjs.com/configuring-npm/package-json.html#files).
The option `ciBuild` uses [`npm
ci`](https://docs.npmjs.com/cli-commands/ci.html) instead of `npm install` and
results in faster install times and guarantees all of your dependencies are
locked appropriately.

This package is setup as a library.
 - It generates .d.ts type files
   - tsconfig.json `declaration: true`
 - It declares library entry points in package.json
   - `exports` for modern runtimes
   - `main` for legacy runtimes
 - It includes compiled .js, .d.ts, and .js.map in dist in the published module
   - `files` in package.json

https://w.amazon.com/bin/view/Users/Calebev/JavaScriptPackaging/
