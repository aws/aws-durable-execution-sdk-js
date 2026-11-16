// A customer bundles the ai subpath with esbuild and installs only the AWS
// SDK clients they use. esbuild leaves a missing package to run time only when
// a `.catch()` sits directly on its `import()`. So this test bundles a copy of
// the ai sources in a directory without node_modules, where no AWS SDK client
// can be resolved.
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterAll, expect, it } from "vitest";

const source = join(__dirname, "..");
const copy = mkdtempSync(join(tmpdir(), "ai-bundle-"));

afterAll(() => rmSync(copy, { recursive: true, force: true }));

it("bundles with esbuild when no optional AWS SDK client is installed", async () => {
  for (const file of readdirSync(source)) {
    if (file.endsWith(".ts")) {
      cpSync(join(source, file), join(copy, file));
    }
  }

  const result = await build({
    entryPoints: [join(copy, "index.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    // The core SDK is a required peer dependency, so a customer has it.
    external: ["@aws/durable-execution-sdk-js"],
  });

  const output = result.outputFiles[0]?.text ?? "";
  for (const client of [
    "@aws-sdk/client-bedrock-agentcore",
    "@aws-sdk/client-bedrock-runtime",
    "@aws-sdk/client-lambda",
    "@aws-sdk/client-sagemaker-runtime",
  ]) {
    // The import stays in the bundle, for run time.
    expect(output).toContain(`import("${client}")`);
  }
});
