// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("lmi-tests/build", { recursive: true });
await build({
  entryPoints: ["lmi-tests/fixture.mjs"],
  outfile: "lmi-tests/build/index.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
});
