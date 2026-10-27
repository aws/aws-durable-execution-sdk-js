import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Packaged-consumer tests must exercise this checkout, not absent or stale dist
// output. Published old-version fixtures are still packed without their scripts.
export default function buildWorkspaceCandidates() {
  const workspace = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  for (const packageName of [
    "packages/aws-durable-execution-sdk-js",
    "packages/aws-durable-execution-sdk-js-testing",
    "packages/aws-durable-execution-sdk-js-otel",
  ]) {
    // Incremental state can otherwise survive deleted declaration output.
    for (const buildInfo of [
      "tsconfig.tsbuildinfo",
      "tsconfig.build.tsbuildinfo",
    ]) {
      rmSync(resolve(workspace, packageName, buildInfo), { force: true });
    }
    execFileSync("npm", ["run", "build", "--workspace", packageName], {
      cwd: workspace,
      stdio: "inherit",
      env: { ...process.env, npm_config_update_notifier: "false" },
    });
  }
}
