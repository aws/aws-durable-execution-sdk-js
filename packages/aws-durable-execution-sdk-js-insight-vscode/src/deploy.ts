import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import AdmZip from "adm-zip";
import { build as esbuildBuild } from "esbuild";
import {
  CreateAliasCommand,
  CreateFunctionCommand,
  type CreateFunctionCommandInput,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  LambdaClient,
  PublishVersionCommand,
  TagResourceCommand,
  UpdateAliasCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionActiveV2,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import {
  AttachRolePolicyCommand,
  CreateRoleCommand,
  GetRoleCommand,
  IAMClient,
  PutRolePolicyCommand,
} from "@aws-sdk/client-iam";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";
import {
  type DarWorkflow,
  analyzeWorkflowPermissions,
  type PermissionAnalysis,
  generateHandler,
  generateHandlerWithMap,
  inferExecutionTimeoutSeconds,
  WORKFLOW_DAR_TS_FILENAME,
  WORKFLOW_DAR_TAG_KEY,
  WORKFLOW_DAR_TAG_VALUE,
} from "@aws/durable-execution-sdk-js-cdk";

const DURABLE_POLICY_ARN =
  "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy";
const ALIAS = "live";
const RUNTIME = "nodejs22.x";

export interface DeployOptions {
  /**
   * Permit `dag` dependency mode. Off by default — see `bundleWorkflowZip`'s
   * `allowDagMode` parameter. Threaded from `workflowInsight.enableDagMode`.
   */
  allowDagMode?: boolean;
  region: string;
  credentials: AwsCredentialIdentityProvider;
  functionName: string;
  /** Explicit execution role ARN; when blank a role is auto-created. */
  roleArn?: string;
  retentionDays: number;
  workflow: DarWorkflow;
  /**
   * The workflow's canonical `.dar.ts` text (see `docs/dar-ts-specification.md`
   * and `darTs.ts`'s `workflowToDarTs`, in this same package — this module
   * stays free of that direct import to avoid a dependency cycle with
   * `extension.ts`/`agent.ts`, so callers convert `workflow`/the wire-format
   * JSON via `workflowToDarTs` themselves before calling `deployWorkflow`).
   * ALWAYS embedded in the deployment package as {@link WORKFLOW_DAR_TS_FILENAME}
   * (`.dar.ts` is the current first-class format for both authoring AND the
   * deploy artifact — see dar-ts-specification.md's Phase 2) — this is not
   * merely a debug-only artifact, unlike `debugOutDir` below.
   */
  darTsText: string;
  onProgress?: (message: string) => void;
  /**
   * Called when the function already exists, before it is updated. Return false
   * to abort the deploy (throws {@link DeployCancelledError}).
   */
  confirmOverwrite?: () => Promise<boolean>;
  /**
   * Called with the IAM permissions inferred from the workflow's code (only when
   * the deploy manages the role, i.e. no explicit {@link DeployOptions.roleArn}).
   * Return true to attach them as an inline policy on the role.
   */
  confirmPermissions?: (analysis: PermissionAnalysis) => Promise<boolean>;
  /**
   * When set, ALSO generates a source map (from the bundled `index.js`
   * straight back to `darTsText`) for remote debugging (e.g. AWS Toolkit for
   * VS Code's "Lambda remote debugging" — see
   * https://docs.aws.amazon.com/toolkit-for-vscode/latest/userguide/lambda-remote-debug.html,
   * which requires a real, separate `.js.map` file — inline maps are not
   * supported there — plus a stable local file it can open as the "Local Root
   * Path"). `debugOutDir` is a STABLE, PERSISTENT directory (unlike the
   * throwaway temp dir used for the actual bundling work) where the bundled
   * `index.js` + `index.js.map`, `darTsText` itself (under
   * `darSourceFileName`), and (for reference) the intermediate `handler.ts` +
   * `handler.ts.map` are all written and left on disk after deploy completes
   * — the debugger needs these to persist across the whole debug session,
   * not just the deploy call. Set a breakpoint directly in the written
   * `.dar.ts` file, on any real line inside a node's function body —
   * statement-level granularity (see `sourceMap.ts`'s doc comment for how).
   */
  debugOutDir?: string;
  /**
   * Filename `darTsText` is written under inside `debugOutDir`, and recorded
   * as the source map's `sources` entry. Defaults to `${functionName}.dar.ts`
   * when `debugOutDir` is set but this is omitted. Ignored when `debugOutDir`
   * is not set (the always-embedded zip entry uses the fixed
   * {@link WORKFLOW_DAR_TS_FILENAME}, unrelated to this).
   */
  darSourceFileName?: string;
  /**
   * Absolute path of the REAL saved `.dar.ts` file `darTsText` came from,
   * when one exists and its on-disk content is byte-identical to
   * `darTsText` (the caller is responsible for checking — see
   * `extension.ts`'s onDeployWorkflow). When set, the final `index.js.map`'s
   * `sources` entry records THIS path instead of the bare
   * `darSourceFileName`, so a debugger resolves straight to the user's own
   * file — which is where Workflow Studio's webview gutter registers its
   * `vscode.SourceBreakpoint`s (see extension.ts's onToggleBreakpoint).
   * Without this, breakpoints set in the webview would never bind: the
   * debugger would map pauses to the `debugOutDir` COPY of the file instead.
   * Ignored when `debugOutDir` is not set.
   */
  darSourceAbsolutePath?: string;
  /**
   * Aborts the deploy at the next step boundary. There is no CloudFormation
   * stack here to roll back — the deploy is a sequence of direct Lambda/IAM
   * calls — so cancellation is COOPERATIVE: it stops before issuing the next
   * call and leaves whatever already succeeded in place. The resulting
   * {@link DeployCancelledError} says exactly what that was.
   */
  signal?: AbortSignal;
}

/**
 * Thrown when the user declines to overwrite an existing function, or cancels
 * mid-deploy via {@link DeployOptions.signal}.
 *
 * `message` always states what was ALREADY applied in AWS, because cancellation
 * is cooperative and coarse: it stops before the next API call, and calls
 * already issued cannot be taken back. "Cancelled" must never be read as
 * "nothing happened".
 */
export class DeployCancelledError extends Error {
  constructor(appliedSoFar = "the existing function was left unchanged.") {
    super(`Cancelled — ${appliedSoFar}`);
    this.name = "DeployCancelledError";
  }
}

export interface DeployResult {
  functionArn: string;
  version: string;
  aliasArn: string;
  region: string;
  executionTimeoutSeconds: number;
}

const errName = (e: unknown): string =>
  (e as { name?: string } | undefined)?.name ?? "";
const errMessage = (e: unknown): string =>
  (e as { message?: string } | undefined)?.message ?? "";

/** `node_modules` dirs from `fromDir` up to the filesystem root (NODE_PATH-style). */
function nodeModulesSearchPaths(fromDir: string): string[] {
  const paths: string[] = [];
  let dir = fromDir;
  for (;;) {
    paths.push(join(dir, "node_modules"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return paths;
}

/**
 * generate → esbuild bundle → zip. Returns a Lambda deployment package.
 * Always embeds `darTsText` as {@link WORKFLOW_DAR_TS_FILENAME} (the current
 * first-class deploy artifact format — see `DeployOptions.darTsText`'s doc
 * comment) so the workflow can be reopened in Studio and edited further.
 *
 * When `debug` is ALSO provided, produces a chained source map from the
 * bundled `index.js` straight back to `darTsText` (skipping the intermediate
 * `handler.ts` entirely in the final map — esbuild consumes `handler.ts`'s
 * own input map, generated by `@aws/durable-execution-sdk-js-cdk`'s
 * `generateHandlerWithMap`, and chains through it automatically because
 * `handler.ts` carries a `//# sourceMappingURL=` comment pointing at it).
 * Debug artifacts are written to `debug.outDir` (a stable, persistent
 * directory — NOT the throwaway temp dir used for the actual bundling work)
 * since a debugger needs them to stay on disk for the life of the debug
 * session. See `DeployOptions.debugOutDir`'s doc comment for the full
 * rationale.
 */
/**
 * The IAM role name a deployed function actually runs as, from its live
 * configuration. Returns undefined when the function or its role cannot be read,
 * so callers can skip a best-effort step rather than acting on a guess.
 *
 * Role ARNs may carry a path (`arn:aws:iam::123:role/some/path/Name`), and
 * `PutRolePolicy` wants the bare name, so take the last segment.
 */
async function resolveFunctionRoleName(
  lambda: LambdaClient,
  functionName: string,
): Promise<string | undefined> {
  try {
    const cfg = await lambda.send(
      new GetFunctionConfigurationCommand({ FunctionName: functionName }),
    );
    const arn = cfg.Role;
    if (typeof arn !== "string" || !arn.includes("/")) return undefined;
    return arn.split("/").pop() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validates a Lambda function name before it is used as a PATH SEGMENT.
 *
 * Both hosts build a debug directory as `join(<base>, functionName)` and write
 * `${functionName}.dar.ts` into it. `path.join` normalizes `..`, so a name like
 * `../../../tmp/x` writes outside the intended directory entirely.
 *
 * This is more than a local footgun because `deploy: { functionName, region }` is a
 * PERSISTED `.dar.ts` field, so the name can arrive from an imported workflow or
 * one produced by a model — not just from the user typing it. Previously the only
 * check was non-emptiness.
 *
 * The AWS charset is the whole legitimate range, and it excludes `.` and `/`, so
 * validating against it removes the traversal rather than trying to sanitize it.
 */
export function requireLambdaFunctionName(
  name: string,
  where = "functionName",
): string {
  const v = name.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(v)) {
    throw new Error(
      `${where} ${JSON.stringify(v)} is not a valid Lambda function name ` +
        `(letters, digits, hyphen and underscore only, up to 64 characters).`,
    );
  }
  return v;
}

export async function bundleWorkflowZip(
  workflow: DarWorkflow,
  darTsText: string,
  debug?: {
    outDir: string;
    darSourceFileName: string;
    /** See DeployOptions.darSourceAbsolutePath. */
    darSourceAbsolutePath?: string;
  },
  /**
   * Permit `dag` dependency mode. Off by default: the generated code calls a
   * runtime the SDK does not implement yet, so a deployed function would fail at
   * invoke time. Threaded from `workflowInsight.enableDagMode`.
   */
  allowDagMode = false,
): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "wf-deploy-"));
  const entry = join(dir, "handler.ts");

  if (debug) {
    const { code, map } = generateHandlerWithMap(
      workflow,
      darTsText,
      debug.darSourceFileName,
      { allowDagMode },
    );
    // `handler.ts`'s OWN map must live next to it (as a real, separate file —
    // never inline) so esbuild can find and chain through it via this
    // comment. esbuild strips this comment from the final bundle and emits
    // its own `//# sourceMappingURL=` pointing at `index.js.map` instead.
    writeFileSync(
      entry,
      `${code}\n//# sourceMappingURL=handler.ts.map\n`,
      "utf-8",
    );
    writeFileSync(join(dir, "handler.ts.map"), map, "utf-8");
    // `handler.ts.map`'s `sources` entry is the bare `darSourceFileName` (see
    // `generateHandlerWithMap`) — esbuild resolves a chained input map's
    // `sources` relative to THAT map's own directory (this temp `dir`), not
    // wherever the caller later copies things. Without a real file here,
    // esbuild still emits a `sources` entry, but as a broken/re-relativized
    // path instead of the clean bare filename a debugger can actually open
    // (confirmed by a real failing test before this fix was added — esbuild
    // silently produced `"../../../.../<abs path>/<file>"` instead of erroring).
    writeFileSync(join(dir, debug.darSourceFileName), darTsText, "utf-8");
  } else {
    writeFileSync(entry, generateHandler(workflow, { allowDagMode }), "utf-8");
  }

  const outfile = join(dir, "index.js");
  await esbuildBuild({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    logLevel: "silent",
    // AWS SDK v3 (`@aws-sdk/*`) is provided by the Lambda nodejs runtime — keep
    // it external so step code can `require("@aws-sdk/client-s3")` etc. without
    // bundling it (and never AWS SDK v2, which the runtime does not include).
    external: ["@aws-sdk/*"],
    // The entry lives in a temp dir, so esbuild can't find the SDK by walking up
    // from it — point resolution at the extension's node_modules chain instead.
    nodePaths: nodeModulesSearchPaths(__dirname),
    // Only requested when debugging: a separate `.js.map` file (AWS Toolkit's
    // Lambda remote debugging explicitly does not support inline maps — see
    // this function's own doc comment) chained through `handler.ts.map` above.
    // `sourcemap: true` (not `"external"`) so esbuild also emits the
    // `//# sourceMappingURL=index.js.map` comment `index.js` needs — without
    // it, nothing (not even AWS Toolkit) can find the map automatically.
    ...(debug ? { sourcemap: true as const } : {}),
  });

  const zip = new AdmZip();
  zip.addFile("index.js", readFileSync(outfile));
  // Embed the full `.dar.ts` so the workflow can be reopened in Studio and
  // edited later (see WORKFLOW_DAR_TAG_KEY). Lambda ignores extra files at
  // runtime. Always the .dar.ts format now — see WORKFLOW_DAR_TS_FILENAME's
  // doc comment for the JSON-format predecessor this replaces.
  zip.addFile(WORKFLOW_DAR_TS_FILENAME, Buffer.from(darTsText, "utf-8"));

  if (debug) {
    // esbuild's own chained map represents the .dar.ts file's `sources` entry
    // relative to (or, when that would be unusually deep — e.g. because
    // `nodePaths` above walks up to the filesystem root — as an ABSOLUTE
    // path into) the ephemeral temp `dir`, never `debug.outDir` (esbuild has
    // no idea `debug.outDir` exists; confirmed by direct inspection during
    // implementation — the raw entry is a real, resolvable path, just not
    // one that stays valid if `dir` is ever cleaned up, which defeats the
    // whole point of `debug.outDir` being a STABLE location). Rewrite that
    // one entry (matched by filename, not full path — the temp dir's exact
    // path is unpredictable) to the clean bare filename before persisting
    // the map anywhere, so the final map a debugger opens from `debug.outDir`
    // never references the temp dir at all.
    const rawMap = JSON.parse(readFileSync(`${outfile}.map`, "utf-8")) as {
      sources: string[];
    };
    const darIdx = rawMap.sources.findIndex((s) =>
      s.endsWith(debug.darSourceFileName),
    );
    // Prefer the user's REAL saved file (absolute path) when the caller
    // vouched for it — that's the file Workflow Studio's webview gutter sets
    // real vscode.SourceBreakpoints against, so the debugger must resolve
    // the mapped source to THAT exact path for those breakpoints to bind.
    // Fall back to the bare filename (resolved relative to the map's own
    // directory, i.e. debug.outDir) when no real saved file exists.
    if (darIdx !== -1)
      rawMap.sources[darIdx] =
        debug.darSourceAbsolutePath ?? debug.darSourceFileName;
    const rewrittenMap = Buffer.from(JSON.stringify(rawMap), "utf-8");

    // Persist everything a debugger needs OUTSIDE the throwaway temp dir
    // (which is never cleaned up here, but is still an OS temp path — not
    // somewhere a user would think to look or rely on across sessions).
    mkdirSync(debug.outDir, { recursive: true });
    copyFileSync(outfile, join(debug.outDir, "index.js"));
    writeFileSync(join(debug.outDir, "index.js.map"), rewrittenMap);
    copyFileSync(entry, join(debug.outDir, "handler.ts"));
    copyFileSync(
      join(dir, "handler.ts.map"),
      join(debug.outDir, "handler.ts.map"),
    );
    // The actual file a user sets breakpoints in — the map's `sources` entry
    // must resolve to this real path for a debugger to open it automatically.
    writeFileSync(
      join(debug.outDir, debug.darSourceFileName),
      darTsText,
      "utf-8",
    );
    // Also embed the debug artifacts in the deployment package itself, so a
    // function deployed with debug info stays self-describing even if
    // `debug.outDir` is later deleted (mirrors WORKFLOW_DAR_TS_FILENAME's own
    // "always embed, never rely on a side-channel" rationale). Lambda ignores
    // extra files, and index.js already ends with a sourceMappingURL comment
    // pointing at this exact filename.
    zip.addFile("index.js.map", rewrittenMap);
  }

  return zip.toBuffer();
}

/** Returns the ARN of the function's execution role, creating it if needed. */
async function ensureExecutionRole(
  iam: IAMClient,
  functionName: string,
  onProgress?: (m: string) => void,
): Promise<string> {
  const roleName = `${functionName}-role`;
  try {
    const got = await iam.send(new GetRoleCommand({ RoleName: roleName }));
    return got.Role?.Arn as string;
  } catch (e) {
    if (errName(e) !== "NoSuchEntityException") throw e;
  }
  onProgress?.(`Creating execution role ${roleName}…`);
  const created = await iam.send(
    new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
      Description: "Execution role for a Workflow Studio durable workflow.",
    }),
  );
  await iam.send(
    new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: DURABLE_POLICY_ARN,
    }),
  );
  // IAM is eventually consistent — let the new role propagate before Lambda
  // tries to assume it.
  await new Promise((r) => setTimeout(r, 10000));
  return created.Role?.Arn as string;
}

/** Create the function, retrying while a freshly-made role still propagates. */
async function createWithRetry(
  lambda: LambdaClient,
  input: CreateFunctionCommandInput,
  attempts = 5,
): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await lambda.send(new CreateFunctionCommand(input));
      return;
    } catch (e) {
      const roleNotReady =
        errName(e) === "InvalidParameterValueException" &&
        /assume/i.test(errMessage(e));
      if (!roleNotReady || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function upsertAlias(
  lambda: LambdaClient,
  functionName: string,
  version: string,
): Promise<string> {
  try {
    const a = await lambda.send(
      new CreateAliasCommand({
        FunctionName: functionName,
        Name: ALIAS,
        FunctionVersion: version,
      }),
    );
    return a.AliasArn as string;
  } catch (e) {
    if (errName(e) !== "ResourceConflictException") throw e;
    const a = await lambda.send(
      new UpdateAliasCommand({
        FunctionName: functionName,
        Name: ALIAS,
        FunctionVersion: version,
      }),
    );
    return a.AliasArn as string;
  }
}

/**
 * Deploys a workflow as a durable Lambda: bundles the generated handler,
 * ensures an execution role, creates or updates the function (with an inferred
 * `executionTimeout`), publishes a version and points the `live` alias at it.
 */
export async function deployWorkflow(
  opts: DeployOptions,
): Promise<DeployResult> {
  const { region, credentials, retentionDays, workflow } = opts;
  // Validated here as well as at the call sites: this name becomes a path segment
  // for the debug artifacts and a `${name}.dar.ts` filename, and it can arrive from
  // a persisted `.dar.ts` rather than from the user.
  const functionName = requireLambdaFunctionName(opts.functionName);
  const onProgress = opts.onProgress;
  const lambda = new LambdaClient({ region, credentials });
  const executionTimeoutSeconds = inferExecutionTimeoutSeconds(workflow);

  onProgress?.("Bundling handler…");
  const debug = opts.debugOutDir
    ? {
        outDir: opts.debugOutDir,
        darSourceFileName: opts.darSourceFileName ?? `${functionName}.dar.ts`,
        darSourceAbsolutePath: opts.darSourceAbsolutePath,
      }
    : undefined;
  const zip = await bundleWorkflowZip(
    workflow,
    opts.darTsText,
    debug,
    opts.allowDagMode === true,
  );

  /**
   * Cancellation checkpoint. Called BEFORE each AWS mutation with a
   * description of what is already applied at that point, so a cancelled
   * deploy reports the true partial state rather than implying a rollback
   * (there is none — see {@link DeployOptions.signal}).
   */
  const cancelPoint = (appliedSoFar: string): void => {
    if (opts.signal?.aborted) throw new DeployCancelledError(appliedSoFar);
  };

  cancelPoint("nothing was changed in AWS.");

  const durableConfig = {
    ExecutionTimeout: executionTimeoutSeconds,
    RetentionPeriodInDays: retentionDays,
  };

  let exists = false;
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
    exists = true;
  } catch (e) {
    if (errName(e) !== "ResourceNotFoundException") throw e;
  }

  if (exists) {
    if (opts.confirmOverwrite && !(await opts.confirmOverwrite())) {
      throw new DeployCancelledError();
    }
    cancelPoint("the existing function was left unchanged.");
    onProgress?.("Updating function code…");
    await lambda.send(
      new UpdateFunctionCodeCommand({
        FunctionName: functionName,
        ZipFile: zip,
      }),
    );
    await waitUntilFunctionUpdatedV2(
      { client: lambda, maxWaitTime: 120 },
      { FunctionName: functionName },
    );
    cancelPoint(
      "the function's code was updated, but its durable config was not, and no new version was published.",
    );
    onProgress?.("Updating durable config…");
    await lambda.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        DurableConfig: durableConfig,
        // Runtime and Handler were previously set ONLY in the create branch, so
        // redeploying onto a function that already existed (one made by an earlier
        // version of this tool, by CDK, or by hand) left it on whatever runtime and
        // handler it already had while we replaced its code with ours. The
        // generated bundle REQUIRES this runtime and `index.handler`, so a mismatch
        // fails at invoke time for a reason the deploy output does not explain.
        // Those two must converge.
        //
        // Timeout, MemorySize and Role are deliberately NOT set. The generated
        // bundle does not require particular values for them, they are exactly the
        // knobs an operator tunes on a live function, and a code update silently
        // resetting memory 1024 -> 256 or timeout 300 -> 60 is destructive in a way
        // a code update is not. They stay create-time defaults only.
        Runtime: RUNTIME,
        Handler: "index.handler",
      }),
    );
    await waitUntilFunctionUpdatedV2(
      { client: lambda, maxWaitTime: 120 },
      { FunctionName: functionName },
    );
  } else {
    let roleArn = opts.roleArn?.trim();
    if (!roleArn) {
      const iam = new IAMClient({ region, credentials });
      roleArn = await ensureExecutionRole(iam, functionName, onProgress);
    }
    cancelPoint(
      "the execution role was created, but no Lambda function was created.",
    );
    onProgress?.("Creating function…");
    await createWithRetry(lambda, {
      FunctionName: functionName,
      Runtime: RUNTIME,
      Role: roleArn,
      Handler: "index.handler",
      Code: { ZipFile: zip },
      Timeout: 60,
      MemorySize: 256,
      DurableConfig: durableConfig,
      Description: "Deployed from Workflow Studio.",
    });
    await waitUntilFunctionActiveV2(
      { client: lambda, maxWaitTime: 120 },
      { FunctionName: functionName },
    );
  }

  const FUNCTION_READY_NOTE =
    'the function\'s code and durable config are deployed, but no new version was published, so the "live" alias still points at the previous version.';

  cancelPoint(FUNCTION_READY_NOTE);

  // Infer the IAM permissions the workflow's code needs and, when the deploy
  // manages the role (no explicit roleArn), optionally attach them as an inline
  // policy. Never modifies a user-supplied role. Best-effort.
  if (!opts.roleArn?.trim()) {
    const analysis = analyzeWorkflowPermissions(workflow);
    if (
      analysis.statements.length > 0 &&
      (!opts.confirmPermissions || (await opts.confirmPermissions(analysis)))
    ) {
      // The review above can take arbitrarily long (it waits on a human), so
      // re-check before acting on its answer.
      cancelPoint(FUNCTION_READY_NOTE);
      onProgress?.("Attaching inferred permissions…");
      try {
        // The role name was previously GUESSED as `${functionName}-role`, which
        // is only right when we created it ourselves in the same run. On the
        // update path `ensureExecutionRole` never runs, so the guess could name a
        // role that does not exist (silently swallowed below) or — worse — an
        // unrelated role that happens to match the pattern. Read the function's
        // effective role instead and derive the name from that ARN.
        const roleName = await resolveFunctionRoleName(lambda, functionName);
        if (!roleName) {
          throw new Error(
            `could not determine the execution role for "${functionName}"`,
          );
        }
        const iam = new IAMClient({ region, credentials });
        await iam.send(
          new PutRolePolicyCommand({
            RoleName: roleName,
            PolicyName: "workflow-inferred-permissions",
            PolicyDocument: JSON.stringify({
              Version: "2012-10-17",
              Statement: analysis.statements.map((s) => ({
                Effect: "Allow",
                Action: s.actions,
                Resource: s.resources,
              })),
            }),
          }),
        );
      } catch (e) {
        onProgress?.(`Couldn't attach inferred permissions: ${errMessage(e)}`);
      }
    }
  }

  cancelPoint(FUNCTION_READY_NOTE);
  onProgress?.("Publishing version…");
  const published = await lambda.send(
    new PublishVersionCommand({ FunctionName: functionName }),
  );
  const version = published.Version as string;
  // Strip the trailing ":<version>" qualifier for the base ARN.
  const functionArn = (published.FunctionArn as string).replace(/:\d+$/, "");

  cancelPoint(
    `version ${version} was published, but the "${ALIAS}" alias still points at the previous version.`,
  );
  onProgress?.(`Pointing alias "${ALIAS}" → version ${version}…`);
  const aliasArn = await upsertAlias(lambda, functionName, version);

  // Tag the function so a reader knows the code package embeds an editable
  // `.dar` worth downloading. Best-effort — a missing tag just means "skip".
  try {
    await lambda.send(
      new TagResourceCommand({
        Resource: functionArn,
        Tags: { [WORKFLOW_DAR_TAG_KEY]: WORKFLOW_DAR_TAG_VALUE },
      }),
    );
  } catch {
    // Tagging is non-critical; ignore failures.
  }

  return { functionArn, version, aliasArn, region, executionTimeoutSeconds };
}
