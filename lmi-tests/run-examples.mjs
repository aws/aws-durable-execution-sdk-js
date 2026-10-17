// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const root = process.cwd();
const manifest = JSON.parse(
  readFileSync("lmi-tests/artifacts/manifest.json", "utf8"),
);
const examples = JSON.parse(
  readFileSync("lmi-tests/build/examples.json", "utf8"),
);
const quarantine = path.join(root, "lmi-tests/artifacts/quarantine.json");
if (existsSync(quarantine)) throw new Error("Shared fixture has not settled");
const env = {
  ...process.env,
  NODE_ENV: "integration",
  LMI_SHARED_EXAMPLES: "1",
  LMI_RUN_ID: manifest.run,
  LMI_CONTROL_SCRIPT: path.join(root, "lmi-tests/deploy.py"),
  LMI_REPO_ROOT: root,
  LMI_QUARANTINE_FILE: quarantine,
  FUNCTION_NAME_MAP: JSON.stringify(
    Object.fromEntries(
      examples.map((example) => [example.handler, manifest.functions.shared]),
    ),
  ),
};
const paths = examples.map((example) =>
  path.join(root, example.path.replace(/\.ts$/, ".test.ts")),
);
const result = spawnSync(
  path.join(root, "node_modules/.bin/jest"),
  [
    "--config",
    "jest.config.integration.js",
    "--bail=0",
    "--runInBand",
    "--runTestsByPath",
    ...paths,
  ],
  {
    cwd: path.join(root, "packages/aws-durable-execution-sdk-js-examples"),
    env,
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
