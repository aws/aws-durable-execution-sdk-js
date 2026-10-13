import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { satisfies } from "semver";

const coreName = "@aws/durable-execution-sdk-js";
const otelName = "@aws/durable-execution-sdk-js-otel";
const workspaceRoot = resolve(__dirname, "../../../../..");
const fromWorkspace = createRequire(join(workspaceRoot, "package.json"));
const fromPublished = createRequire(
  join(workspaceRoot, "packages/otel-compatibility-fixtures/package.json"),
);

type Manifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
const manifest = (directory: string): Manifest =>
  JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
function packageDirectory(
  name: string,
  expectedName = name,
  resolver = fromWorkspace,
): string {
  let directory = dirname(resolver.resolve(name));
  while (directory !== dirname(directory)) {
    try {
      if (manifest(directory).name === expectedName) return directory;
    } catch {
      /* Find the package manifest above its entry point. */
    }
    directory = dirname(directory);
  }
  throw new Error(`Cannot locate dependency ${name}`);
}

/** Packed packages in isolated application/layer trees, outside workspace resolution. */
export class InstalledCoreFixture {
  readonly directory = mkdtempSync(
    join(
      process.env.DURABLE_PACKAGE_TEST_TMPDIR ?? tmpdir(),
      "otel-core-compatibility-",
    ),
  );
  readonly applicationDirectory = join(this.directory, "application");
  readonly layerDirectory: string | undefined;
  readonly coreVersion: string;
  readonly otelVersion: string;
  readonly peerRange: string;
  readonly peerAccepted: boolean;
  readonly coreRequired: boolean;

  constructor(
    coreChoice: boolean | "minimum" | "previous" | "current",
    options: { previousPlugin?: boolean; layer?: boolean } = {},
  ) {
    const core =
      coreChoice === true
        ? "previous"
        : coreChoice === false
          ? "current"
          : coreChoice;
    const coreDirectory =
      core === "minimum"
        ? packageDirectory(coreName, coreName, fromPublished)
        : core === "previous"
          ? packageDirectory("@aws/durable-execution-sdk-js-previous", coreName)
          : join(workspaceRoot, "packages/aws-durable-execution-sdk-js");
    const otelDirectory = options.previousPlugin
      ? packageDirectory(otelName, otelName, fromPublished)
      : join(workspaceRoot, "packages/aws-durable-execution-sdk-js-otel");
    const corePackage = manifest(coreDirectory);
    const otelPackage = manifest(otelDirectory);
    this.coreVersion = corePackage.version;
    this.otelVersion = otelPackage.version;
    this.peerRange = otelPackage.peerDependencies![coreName];
    this.peerAccepted = satisfies(this.coreVersion, this.peerRange);
    this.coreRequired =
      otelPackage.peerDependenciesMeta?.[coreName]?.optional !== true;
    this.layerDirectory = options.layer
      ? join(this.directory, "layer/nodejs")
      : undefined;
    const pluginRoot = this.layerDirectory ?? this.applicationDirectory;
    this.installPackage(coreDirectory, this.applicationDirectory);
    this.installPackage(otelDirectory, pluginRoot);
    const coreDependencies = corePackage.dependencies ?? {};
    const pluginDependencies = { ...otelPackage.peerDependencies };
    delete pluginDependencies[coreName];
    for (const [root, dependencies] of [
      [this.applicationDirectory, coreDependencies],
      [pluginRoot, pluginDependencies],
    ] as const) {
      for (const name of Object.keys(dependencies)) {
        const installed = join(root, "node_modules", name);
        if (!existsSync(installed)) {
          mkdirSync(dirname(installed), { recursive: true });
          symlinkSync(packageDirectory(name), installed, "dir");
        }
      }
    }
    writeFileSync(
      join(this.applicationDirectory, "package.json"),
      JSON.stringify({
        private: true,
        dependencies: {
          [coreName]: this.coreVersion,
          ...coreDependencies,
          ...(this.layerDirectory
            ? {}
            : { [otelName]: this.otelVersion, ...pluginDependencies }),
        },
      }),
    );
    if (this.layerDirectory)
      writeFileSync(
        join(this.layerDirectory, "package.json"),
        JSON.stringify({
          private: true,
          dependencies: { [otelName]: this.otelVersion, ...pluginDependencies },
        }),
      );
    symlinkSync(
      join(workspaceRoot, "node_modules/@types"),
      join(this.applicationDirectory, "node_modules/@types"),
      "dir",
    );
  }

  private npmEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      npm_config_cache: join(this.directory, "cache"),
      npm_config_offline: "true",
      npm_config_update_notifier: "false",
    };
  }

  private installPackage(directory: string, root: string): void {
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
        { cwd: this.directory, encoding: "utf8", env: this.npmEnvironment() },
      ),
    ) as { filename: string }[];
    const installed = join(root, "node_modules", manifest(directory).name);
    mkdirSync(installed, { recursive: true });
    execFileSync("tar", [
      "-xzf",
      join(this.directory, pack[0].filename),
      "-C",
      installed,
      "--strip-components=1",
    ]);
  }

  validateInstalledPeers(): { status: number | null; output: string } {
    const result = spawnSync("npm", ["ls", "--json", "--depth=1", coreName], {
      cwd: this.applicationDirectory,
      encoding: "utf8",
      env: this.npmEnvironment(),
    });
    return { status: result.status, output: result.stdout + result.stderr };
  }

  typecheckConsumer(source: string): { status: number | null; output: string } {
    const input = join(this.applicationDirectory, "consumer.ts");
    writeFileSync(input, source);
    writeFileSync(
      join(this.applicationDirectory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          noEmit: true,
          strict: true,
          skipLibCheck: false,
          module: "esnext",
          moduleResolution: "bundler",
          target: "ES2022",
          types: ["node"],
        },
        files: ["consumer.ts"],
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        fromWorkspace.resolve("typescript/bin/tsc"),
        "--project",
        "tsconfig.json",
      ],
      { cwd: this.applicationDirectory, encoding: "utf8" },
    );
    return { status: result.status, output: result.stdout + result.stderr };
  }

  run<T>(source: string, environment: Record<string, string> = {}): T {
    return JSON.parse(
      execFileSync(process.execPath, ["-e", source], {
        cwd: this.applicationDirectory,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: this.layerDirectory
            ? join(this.layerDirectory, "node_modules")
            : "",
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
