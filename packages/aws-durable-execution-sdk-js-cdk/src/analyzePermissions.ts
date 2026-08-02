import type { DarWorkflow } from "./darModel";
import { getServiceIntegration } from "@aws/durable-execution-sdk-js-visual-workflow-model";

/** One inferred IAM statement (grouped for review). */
export interface InferredStatement {
  actions: string[];
  resources: string[];
  /** Human-readable origin, shown in the review UI. */
  source: string;
}

export interface PermissionAnalysis {
  statements: InferredStatement[];
  /** Things we couldn't map confidently — surfaced so nothing is silent. */
  warnings: string[];
}

/** `@aws-sdk/client-<pkg>` suffix -> IAM service prefix, where they differ. */
const SERVICE_PREFIX: Record<string, string> = {
  "bedrock-runtime": "bedrock",
  "bedrock-agent-runtime": "bedrock",
  "secrets-manager": "secretsmanager",
  "cloudwatch-logs": "logs",
  "cloudwatch-events": "events",
  eventbridge: "events",
  sfn: "states",
  sesv2: "ses",
  "dynamodb-streams": "dynamodb",
};

/** Fixes command->action names that don't follow the `Command`-stripping rule. */
const ACTION_OVERRIDES: Record<string, string> = {
  // `InvokeCommand` strips to `Invoke`, but the IAM action is `InvokeFunction`.
  "lambda:Invoke": "lambda:InvokeFunction",
  "s3:ListObjectsV2": "s3:ListBucket",
  "s3:ListObjects": "s3:ListBucket",
  "s3:DeleteObjects": "s3:DeleteObject",
  "s3:HeadObject": "s3:GetObject",
  "s3:HeadBucket": "s3:ListBucket",
  "dynamodb:BatchWriteItem": "dynamodb:BatchWriteItem",
};

interface Collected {
  snippets: string[];
  invokes: { name: string; arn?: string }[];
  jobs: { name: string; integration?: string }[];
}

/** Recursively gathers code snippets + chainInvoke targets from the workflow. */
function collect(wf: DarWorkflow, out: Collected): void {
  for (const node of wf.nodes) {
    for (const field of [
      "code",
      "itemsCode",
      "submitterCode",
      "stopCondition",
    ]) {
      const v = (node as Record<string, unknown>)[field];
      if (typeof v === "string" && v.trim()) out.snippets.push(v);
    }
    for (const b of node.onError ?? []) {
      if (typeof b.fallbackCode === "string" && b.fallbackCode.trim()) {
        out.snippets.push(b.fallbackCode);
      }
    }
    if (node.kind === "chainInvoke") {
      const arn = (node as Record<string, unknown>).functionArn;
      out.invokes.push({
        name: node.name,
        arn: typeof arn === "string" && arn.trim() ? arn.trim() : undefined,
      });
    }
    if (node.kind === "awsJob") {
      const integration = (node as Record<string, unknown>).integration;
      out.jobs.push({
        name: node.name,
        integration: typeof integration === "string" ? integration : undefined,
      });
    }
    if (node.kind === "awsSdkCall") {
      // Reuse the step-code scanner: a synthetic import + usage lets the
      // existing service/command attribution (incl. SERVICE_PREFIX + overrides)
      // infer `service:Action` for the reflected call.
      const n = node as Record<string, unknown>;
      const pkg = typeof n.clientPackage === "string" ? n.clientPackage : "";
      const cmd = typeof n.command === "string" ? n.command : "";
      if (pkg && cmd) {
        out.snippets.push(
          `import { ${cmd} } from ${JSON.stringify(pkg)};\nnew ${cmd}();`,
        );
      }
    }
    const body = (node as { body?: unknown }).body as DarWorkflow | undefined;
    if (body && Array.isArray(body.nodes)) collect(body, out);
    const branches = (node as { branches?: unknown }).branches;
    if (Array.isArray(branches)) {
      for (const br of branches) {
        const bBody = (br as { body?: unknown } | null)?.body as
          | DarWorkflow
          | undefined;
        if (bBody && Array.isArray(bBody.nodes)) collect(bBody, out);
      }
    }
  }
}

const IMPORT_RE =
  /(?:(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*["']@aws-sdk\/client-([\w-]+)["']\s*\))|(?:import\s*\{([^}]*)\}\s*from\s*["']@aws-sdk\/client-([\w-]+)["'])/g;
const CLIENT_RE = /@aws-sdk\/client-([\w-]+)/g;
const COMMAND_RE = /\b([A-Z]\w*)Command\b/g;

function actionFor(service: string, command: string): string {
  const prefix = SERVICE_PREFIX[service] ?? service;
  const raw = `${prefix}:${command}`;
  return ACTION_OVERRIDES[raw] ?? raw;
}

/**
 * Infers the IAM permissions a workflow's code needs by scanning each code field
 * for AWS SDK v3 usage (`@aws-sdk/client-<svc>` + `<Xxx>Command`) and mapping
 * `chainInvoke` nodes to `lambda:InvokeFunction`. Heuristic and review-oriented:
 * resources default to `*` and anything it can't attribute is returned as a
 * warning rather than silently dropped or over-granted.
 */
export function analyzeWorkflowPermissions(
  workflow: DarWorkflow,
): PermissionAnalysis {
  const collected: Collected = { snippets: [], invokes: [], jobs: [] };
  collect(workflow, collected);

  const actionsByService = new Map<string, Set<string>>();
  const warnings = new Set<string>();

  for (const code of collected.snippets) {
    // Map command -> service via destructured import/require when possible.
    const cmdService = new Map<string, string>();
    for (const m of code.matchAll(IMPORT_RE)) {
      const names = (m[1] ?? m[3] ?? "").split(",");
      const service = m[2] ?? m[4];
      for (const n of names) {
        // The local name is the first whitespace-delimited token, whether the
        // specifier is `Foo` or `Foo as Bar`. Found with a single-character
        // search rather than `split(/\s+as\s+/)`, which is polynomial on a long
        // run of whitespace — and this input is workflow code, so a pathological
        // import line could hang the permission analysis.
        const trimmed = n.trim();
        const space = trimmed.search(/\s/);
        const id = space === -1 ? trimmed : trimmed.slice(0, space);
        if (id.endsWith("Command")) cmdService.set(id, service);
      }
    }
    const services = new Set([...code.matchAll(CLIENT_RE)].map((m) => m[1]));
    const commands = new Set(
      [...code.matchAll(COMMAND_RE)].map((m) => `${m[1]}Command`),
    );
    if (commands.size > 0 && services.size === 0) {
      warnings.add(
        "Found AWS command usage but no `@aws-sdk/client-*` import to attribute it to.",
      );
    }
    for (const command of commands) {
      let service = cmdService.get(command);
      if (!service) {
        if (services.size === 1) service = [...services][0];
        else {
          warnings.add(
            `Couldn't attribute ${command} to a service (multiple @aws-sdk clients in one step) — add it manually.`,
          );
          continue;
        }
      }
      const action = actionFor(service, command.replace(/Command$/, ""));
      const prefix = action.split(":")[0];
      if (!actionsByService.has(prefix))
        actionsByService.set(prefix, new Set());
      actionsByService.get(prefix)?.add(action);
    }
  }

  const statements: InferredStatement[] = [];
  for (const [service, actions] of [...actionsByService.entries()].sort()) {
    statements.push({
      actions: [...actions].sort(),
      resources: ["*"],
      source: `${service} calls in step code`,
    });
  }

  // chainInvoke -> lambda:InvokeFunction, grouped by target ARN.
  const invokeByArn = new Map<string, string[]>();
  for (const inv of collected.invokes) {
    const key = inv.arn ?? "*";
    if (!invokeByArn.has(key)) invokeByArn.set(key, []);
    invokeByArn.get(key)?.push(inv.name);
    if (!inv.arn) {
      warnings.add(
        `chainInvoke "${inv.name}" has no function ARN — granting lambda:InvokeFunction on "*".`,
      );
    }
  }
  for (const [arn, names] of invokeByArn) {
    statements.push({
      actions: ["lambda:InvokeFunction"],
      resources: [arn],
      source: `chainInvoke: ${names.join(", ")}`,
    });
  }

  // awsJob nodes -> the preset's start/poll IAM actions, grouped by service.
  const jobActionsByService = new Map<string, Set<string>>();
  for (const job of collected.jobs) {
    const preset = getServiceIntegration(job.integration);
    if (!preset) {
      warnings.add(
        `awsJob "${job.name}" has an unknown integration ${JSON.stringify(
          job.integration,
        )} — no permissions inferred.`,
      );
      continue;
    }
    if (!jobActionsByService.has(preset.service))
      jobActionsByService.set(preset.service, new Set());
    const set = jobActionsByService.get(preset.service) as Set<string>;
    for (const a of preset.iamActions) set.add(a);
  }
  for (const [service, actions] of [...jobActionsByService.entries()].sort()) {
    statements.push({
      actions: [...actions].sort(),
      resources: ["*"],
      source: `${service} job integration`,
    });
  }

  // Static analysis can't derive concrete ARNs for most SDK calls, so those
  // statements use Resource "*". Flag it explicitly so the deploy confirmation
  // makes the account-wide scope obvious (and a reminder to tighten for prod).
  const wildcardCount = statements.filter((s) =>
    s.resources.includes("*"),
  ).length;
  if (wildcardCount > 0) {
    warnings.add(
      `${wildcardCount} permission group(s) grant Resource "*" (account-wide) ` +
        `— scope these to specific ARNs before production use.`,
    );
  }

  return { statements, warnings: [...warnings] };
}
