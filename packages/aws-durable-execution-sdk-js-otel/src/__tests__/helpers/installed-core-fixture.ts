import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { satisfies } from "semver";

const coreName = "@aws/durable-execution-sdk-js";
const otelName = "@aws/durable-execution-sdk-js-otel";
const workspaceRoot = resolve(__dirname, "../../../../..");
const fromWorkspace = createRequire(join(workspaceRoot, "package.json"));

type Manifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
const manifest = (directory: string): Manifest =>
  JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));

function packageDirectory(name: string, expectedName = name): string {
  let directory = dirname(fromWorkspace.resolve(name));
  while (directory !== dirname(directory)) {
    try {
      if (manifest(directory).name === expectedName) return directory;
    } catch {
      // Keep walking from a package's resolved entry point to its manifest.
    }
    directory = dirname(directory);
  }
  throw new Error(`Cannot locate dependency ${name}`);
}

/** Real packed core/OTel copies, isolated from workspace package symlinks. */
export class InstalledCoreFixture {
  readonly directory = mkdtempSync(
    join(workspaceRoot, "node_modules/.otel-core-compatibility-"),
  );
  readonly coreVersion: string;
  readonly peerRange: string;
  readonly peerAccepted: boolean;
  readonly coreRequired: boolean;

  constructor(previousCore: boolean) {
    const coreDirectory = previousCore
      ? packageDirectory("@aws/durable-execution-sdk-js-previous", coreName)
      : join(workspaceRoot, "packages/aws-durable-execution-sdk-js");
    const otelDirectory = join(
      workspaceRoot,
      "packages/aws-durable-execution-sdk-js-otel",
    );
    const core = manifest(coreDirectory);
    const otel = manifest(otelDirectory);
    this.coreVersion = core.version;
    this.peerRange = otel.peerDependencies![coreName];
    this.peerAccepted = satisfies(core.version, this.peerRange);
    this.coreRequired =
      otel.peerDependenciesMeta?.[coreName]?.optional !== true;
    for (const directory of [coreDirectory, otelDirectory]) {
      const pack = JSON.parse(
        execFileSync(
          "npm",
          [
            "pack",
            directory,
            "--json",
            "--ignore-scripts",
            "--pack-destination",
            this.directory,
          ],
          {
            cwd: this.directory,
            encoding: "utf8",
            env: {
              ...process.env,
              npm_config_cache: join(this.directory, "cache"),
              npm_config_offline: "true",
              npm_config_update_notifier: "false",
            },
          },
        ),
      ) as { filename: string }[];
      const installed = join(
        this.directory,
        "node_modules",
        manifest(directory).name,
      );
      mkdirSync(installed, { recursive: true });
      execFileSync("tar", [
        "-xzf",
        join(this.directory, pack[0].filename),
        "-C",
        installed,
        "--strip-components=1",
      ]);
    }
    const dependencies = { ...core.dependencies, ...otel.peerDependencies };
    delete dependencies[coreName];
    // Reuse only third-party runtime dependencies. The two packages under test
    // are extracted npm tarballs, never workspace links or module mappings.
    for (const name of Object.keys(dependencies)) {
      const installed = join(this.directory, "node_modules", name);
      mkdirSync(dirname(installed), { recursive: true });
      symlinkSync(packageDirectory(name), installed, "dir");
    }
    writeFileSync(
      join(this.directory, "package.json"),
      JSON.stringify({
        private: true,
        dependencies: {
          [coreName]: core.version,
          [otelName]: otel.version,
          ...dependencies,
        },
      }),
    );
  }

  /** npm's installed-tree validator must flag the old core's peer mismatch. */
  validateInstalledPeers(): { status: number | null; output: string } {
    const result = spawnSync("npm", ["ls", "--json", "--depth=1", coreName], {
      cwd: this.directory,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: join(this.directory, "cache"),
        npm_config_offline: "true",
        npm_config_update_notifier: "false",
      },
    });
    return { status: result.status, output: result.stdout + result.stderr };
  }

  run<T>(source: string, environment: Record<string, string> = {}): T {
    return JSON.parse(
      execFileSync(process.execPath, ["-e", source], {
        cwd: this.directory,
        encoding: "utf8",
        env: {
          ...process.env,
          _X_AMZN_TRACE_ID: "",
          DURABLE_EXECUTION_PLUGINS: "",
          ...environment,
        },
      }),
    );
  }

  cleanup(): void {
    rmSync(this.directory, { recursive: true, force: true });
  }
}

export const invocationFixture = `
const core = require('@aws/durable-execution-sdk-js');
const otel = require('@aws/durable-execution-sdk-js-otel');
const { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor, AlwaysOnSampler } = require('@opentelemetry/sdk-trace-node');
const event = new core.DurableExecutionInvocationInputWithClient({
  DurableExecutionArn: 'arn:execution:installed-consumer', CheckpointToken: 'token',
  InitialExecutionState: { Operations: [{ Id: 'execution', Type: 'EXECUTION', Status: 'STARTED', StartTimestamp: new Date('2026-01-01T00:00:00Z'), ExecutionDetails: { InputPayload: '{}' } }] }
}, { checkpoint: async () => { throw new Error('unexpected AWS request'); }, getExecutionState: async () => { throw new Error('unexpected AWS request'); } });
const lambdaContext = { awsRequestId: 'request', getRemainingTimeInMillis: () => 30000 };
`;
