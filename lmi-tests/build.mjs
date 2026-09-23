// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
await mkdir("lmi-tests/build", { recursive: true });
const catalog = JSON.parse(
  await readFile(
    "packages/aws-durable-execution-sdk-js-examples/src/utils/examples-catalog.json",
    "utf8",
  ),
);
const examples = catalog.filter((example) => example.capacityProviderConfig);
if (examples.length === 0)
  throw new Error("No capacity-provider examples selected");
const imports = examples.map((example, index) => {
  if ((example.lambdaTimeoutSeconds ?? 60) > 60)
    throw new Error(
      `Example requires a different invocation timeout: ${example.handler}`,
    );
  const relative = path
    .relative(path.resolve("lmi-tests/build"), example.path)
    .split(path.sep)
    .join("/");
  return `import { handler as h${index} } from ${JSON.stringify(relative)};`;
});
const fields = examples.map(
  (example, index) =>
    `${JSON.stringify(example.handler.split(".")[0])}: h${index}`,
);
await writeFile(
  "lmi-tests/build/registry.mjs",
  `${imports.join("\n")}\nexport const handlers = {${fields.join(",\n")}};\n`,
);
await writeFile(
  "lmi-tests/build/examples.json",
  JSON.stringify(
    examples.map((example) => ({
      handler: example.handler.split(".")[0],
      path: path.relative(process.cwd(), example.path),
    })),
    null,
    2,
  ),
);
await build({
  entryPoints: ["lmi-tests/entry.mjs"],
  outfile: "lmi-tests/build/index.cjs",
  bundle: true,
  // Error types and unnamed-operation diagnostics can depend on function/class
  // names. Preserve them when many original handlers share one bundle.
  keepNames: true,
  platform: "node",
  target: "node24",
  format: "cjs",
});
