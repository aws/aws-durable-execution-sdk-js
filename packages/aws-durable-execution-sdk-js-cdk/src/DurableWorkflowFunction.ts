import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Annotations, Duration, Tags } from "aws-cdk-lib";
import { Alias, type IVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { analyzeWorkflowPermissions } from "./analyzePermissions";
import {
  type ICommandHooks,
  NodejsFunction,
  type NodejsFunctionProps,
  OutputFormat,
} from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import type { DarWorkflow } from "./darModel";
import { loadWorkflow } from "./darModel";
import { generateHandler } from "./generateHandler";
import {
  serializeWorkflow,
  WORKFLOW_DAR_FILENAME,
  WORKFLOW_DAR_TAG_KEY,
  WORKFLOW_DAR_TAG_VALUE,
} from "./darArtifact";
import { hasUnboundedWait, inferExecutionTimeoutSeconds } from "./timeout";

/** Props for {@link DurableWorkflowFunction}. */
export interface DurableWorkflowFunctionProps {
  /** The workflow to deploy. Provide this or {@link darPath}. */
  readonly workflow?: DarWorkflow;
  /** Path to a `.dar` file to deploy. Provide this or {@link workflow}. */
  readonly darPath?: string;
  /**
   * Overrides the durable execution timeout. When omitted, it is inferred from
   * the workflow's waits via {@link inferExecutionTimeoutSeconds}.
   */
  readonly executionTimeout?: Duration;
  /** How long Lambda retains execution history (1–90 days). @default 14 days */
  readonly retentionPeriod?: Duration;
  /** Name of the alias created for qualified invocation. @default "live" */
  readonly aliasName?: string;
  /**
   * Extra options forwarded to the underlying `NodejsFunction` (memory, env,
   * timeout, layers, bundling overrides, …). `entry`, `handler` and
   * `durableConfig` are managed by the construct.
   */
  readonly functionProps?: Omit<
    NodejsFunctionProps,
    "entry" | "handler" | "durableConfig"
  >;
  /**
   * Analyze the workflow's code and grant the inferred IAM permissions
   * (AWS SDK v3 usage + `chainInvoke` targets) to the function role.
   *
   * Only statements whose resources can be RESOLVED are granted — in practice
   * `chainInvoke` targets, where the function ARN is known. Statements that would
   * need `Resource: "*"` are withheld and reported; see
   * {@link grantWildcardPermissions}.
   *
   * @default true
   */
  readonly grantInferredPermissions?: boolean;
  /**
   * Also grant inferred statements whose resources are `"*"`.
   *
   * Actions are inferred by pattern-matching AWS SDK v3 usage in step code, and
   * that analysis cannot tell WHICH bucket, table or queue a call targets — so
   * those statements come out as `Resource: "*"`. Attaching them automatically
   * would mean a construct silently granting wildcard access based on a regex,
   * which is not a least-privilege default no matter how convenient.
   *
   * Left off, the wildcard statements are reported as a CDK warning listing the
   * exact actions, so they can be added deliberately and scoped by hand.
   *
   * @default false
   */
  readonly grantWildcardPermissions?: boolean;
}

/**
 * A durable Lambda function generated from a Workflow Studio `.dar` workflow.
 *
 * At synth time it generates a `withDurableExecution` handler from the
 * workflow, bundles it (with the SDK) via `NodejsFunction`, enables durable
 * execution with an inferred `executionTimeout`, and publishes a version + an
 * alias so the function can be invoked with a qualified identifier.
 *
 * @example
 * ```ts
 * new DurableWorkflowFunction(this, "OrderWorkflow", {
 *   darPath: path.join(__dirname, "order.dar"),
 *   retentionPeriod: Duration.days(7),
 * });
 * ```
 */
export class DurableWorkflowFunction extends Construct {
  /** The underlying bundled Lambda function. */
  public readonly handler: NodejsFunction;
  /** The published version (qualified). */
  public readonly version: IVersion;
  /** The alias pointing at {@link version} (use this to invoke). */
  public readonly alias: Alias;
  /** The effective durable execution timeout (inferred unless overridden). */
  public readonly executionTimeout: Duration;
  /** The generated handler source (useful for tests/inspection). */
  public readonly generatedCode: string;

  constructor(
    scope: Construct,
    id: string,
    props: DurableWorkflowFunctionProps,
  ) {
    super(scope, id);

    const workflow =
      props.workflow ??
      (props.darPath ? loadWorkflow(props.darPath) : undefined);
    if (!workflow) {
      throw new Error(
        "DurableWorkflowFunction requires either `workflow` or `darPath`.",
      );
    }

    this.generatedCode = generateHandler(workflow);
    if (props.executionTimeout === undefined && hasUnboundedWait(workflow)) {
      // Inference cannot bound a dynamic wait or a chained durable invoke, so it
      // falls back to the one-year cap. Erring long is the safe direction, but it
      // is not a real estimate — say so rather than letting a silent one year
      // look deliberate.
      Annotations.of(this).addWarning(
        "Cannot infer executionTimeout: this workflow has a wait with a dynamic " +
          "duration or a chained durable invoke, whose length is unknown at synth " +
          "time. Defaulting to the one-year maximum. Set executionTimeout " +
          "explicitly to bound this function.",
      );
    }
    this.executionTimeout =
      props.executionTimeout ??
      Duration.seconds(inferExecutionTimeoutSeconds(workflow));

    const entry = writeGeneratedHandler(this.node.addr, this.generatedCode);
    // Persist the full `.dar` next to the handler and copy it into the bundled
    // asset, so the deployed package embeds it (matching the VS Code deploy).
    // The workflow can then be reopened in Studio and edited from either path.
    const darPath = join(dirname(entry), WORKFLOW_DAR_FILENAME);
    writeFileSync(darPath, serializeWorkflow(workflow), "utf-8");
    const userHooks = props.functionProps?.bundling?.commandHooks;
    const commandHooks: ICommandHooks = {
      beforeBundling: (i, o) => userHooks?.beforeBundling(i, o) ?? [],
      beforeInstall: (i, o) => userHooks?.beforeInstall(i, o) ?? [],
      afterBundling: (i, o) => {
        const dest = join(o, WORKFLOW_DAR_FILENAME);
        // Copy the embedded `.dar` into the asset. Use a platform-appropriate
        // command since local bundling runs in the host shell (Windows `cmd`
        // has no `cp`).
        const copy =
          process.platform === "win32"
            ? `copy /Y "${darPath}" "${dest}"`
            : `cp "${darPath}" "${dest}"`;
        return [...(userHooks?.afterBundling(i, o) ?? []), copy];
      },
    };

    this.handler = new NodejsFunction(this, "Function", {
      runtime: Runtime.NODEJS_22_X,
      // The Lambda INVOCATION timeout, which is not the same thing as
      // durableConfig.executionTimeout: the latter bounds the whole durable
      // execution (days or months), the former bounds one invocation. Leaving it
      // unset inherited NodejsFunction's 3-SECOND default, so any single step doing
      // real work was killed while the durable timeout looked generous. 60s matches
      // the VS Code deploy path's create default. Overridable via functionProps,
      // which is spread after this.
      timeout: Duration.seconds(60),
      ...props.functionProps,
      entry,
      handler: "handler",
      durableConfig: {
        executionTimeout: this.executionTimeout,
        ...(props.retentionPeriod
          ? { retentionPeriod: props.retentionPeriod }
          : {}),
      },
      bundling: {
        format: OutputFormat.CJS,
        target: "node22",
        ...props.functionProps?.bundling,
        commandHooks,
      },
    });

    // Hint that this function's code package embeds an editable `.dar`.
    Tags.of(this.handler).add(WORKFLOW_DAR_TAG_KEY, WORKFLOW_DAR_TAG_VALUE);

    // Grant the IAM permissions inferred from the workflow's code (SDK v3 usage
    // + chainInvoke targets) unless the caller opts out.
    if (props.grantInferredPermissions !== false) {
      const { statements, warnings } = analyzeWorkflowPermissions(workflow);
      // `warnings` are the analysis's UNDER-grant signals ("couldn't attribute
      // command to a service", "awsJob has an unknown integration"). Dropping them
      // meant deploy succeeded, the function hit AccessDenied at runtime, and synth
      // had given no hint that a permission had been missed.
      for (const w of warnings) {
        Annotations.of(this).addWarning(`Permission inference: ${w}`);
      }
      const isWildcard = (stmt: { resources: string[] }) =>
        stmt.resources.includes("*");
      const wildcard = statements.filter(isWildcard);
      const scoped = statements.filter((st) => !isWildcard(st));

      for (const stmt of scoped) {
        this.handler.addToRolePolicy(
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: stmt.actions,
            resources: stmt.resources,
          }),
        );
      }

      if (wildcard.length > 0) {
        if (props.grantWildcardPermissions === true) {
          for (const stmt of wildcard) {
            this.handler.addToRolePolicy(
              new PolicyStatement({
                effect: Effect.ALLOW,
                actions: stmt.actions,
                resources: stmt.resources,
              }),
            );
          }
        } else {
          // Actions are inferred by regex over step code, so the analysis cannot
          // know which resource a call targets and these come out as "*".
          // Granting them by default would let a construct hand out wildcard
          // access based on a pattern match. Report instead, with enough detail
          // to add them deliberately.
          const actions = [
            ...new Set(wildcard.flatMap((st) => st.actions)),
          ].sort();
          Annotations.of(this).addWarning(
            `Inferred ${actions.length} IAM action(s) whose resources could not ` +
              `be determined, so they were NOT granted: ${actions.join(", ")}. ` +
              `Add them to the function role scoped to the resources you intend, ` +
              `or set grantWildcardPermissions: true to attach them with ` +
              `Resource: "*".`,
          );
        }
      }
    }

    this.version = this.handler.currentVersion;
    this.alias = new Alias(this, "Alias", {
      aliasName: props.aliasName ?? "live",
      version: this.version,
    });
  }
}

/**
 * Writes the generated handler to a per-construct directory under the project's
 * working directory (where `cdk synth` runs), so the bundler resolves the SDK
 * from the project's `node_modules`. The directory should be gitignored.
 */
function writeGeneratedHandler(addr: string, code: string): string {
  const dir = join(process.cwd(), ".durable-execution-workflows", addr);
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, "handler.ts");
  writeFileSync(entry, code, "utf-8");
  return entry;
}
