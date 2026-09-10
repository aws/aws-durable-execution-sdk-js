/**
 * Cloud entry point for the Bedrock support-agent example.
 *
 * esbuild bundles this file (compiling the example's TypeScript source, inlining the core SDK
 * from the monorepo root node_modules, and inlining `@aws-sdk/client-bedrock-runtime`) into a
 * single CJS file deployed as the Lambda handler `index.handler`.
 *
 * We import from TypeScript SOURCE (`../handler`) rather than any built `dist`, matching the
 * package's own `cloud/entry.mjs`: esbuild compiles TS natively, so pointing at source bundles
 * exactly the reviewed code. `handler.ts` wires the graph to the REAL Bedrock model — the model
 * stub used by the local test lives only in the test and is never bundled here.
 */

import { handler } from "../handler";

export { handler };
