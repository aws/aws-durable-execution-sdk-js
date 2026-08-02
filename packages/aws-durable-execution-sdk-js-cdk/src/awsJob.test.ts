import { generateHandler } from "./generateHandler";
import { analyzeWorkflowPermissions } from "./analyzePermissions";
import { inferExecutionTimeoutSeconds } from "./timeout";
import type { DarWorkflow } from "./darModel";

/** A minimal workflow with a single Glue job between start and end. */
function glueWorkflow(): DarWorkflow {
  return {
    darVersion: "1.0.0",
    name: "glue-wf",
    dependencyMode: "linear",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      {
        id: "j",
        kind: "awsJob",
        name: "runEtl",
        integration: "glue.startJobRun",
        startInput: '{ "JobName": "my-etl" }',
        pollIntervalSeconds: 15,
      } as DarWorkflow["nodes"][number],
      { id: "e", kind: "end", name: "end" },
    ],
    edges: [
      { id: "e1", source: "s", target: "j" },
      { id: "e2", source: "j", target: "e" },
    ],
  };
}

describe("awsJob codegen", () => {
  const src = generateHandler(glueWorkflow());

  it("imports the AWS SDK v3 client + commands", () => {
    expect(src).toContain(
      'import { GetJobRunCommand, GlueClient, StartJobRunCommand } from "@aws-sdk/client-glue";',
    );
  });

  it("emits a start step and a poll waitForCondition", () => {
    expect(src).toContain('.step("runEtl-start"');
    expect(src).toContain(".waitForCondition(");
    expect(src).toContain('"runEtl-wait"');
    expect(src).toContain("new StartJobRunCommand");
    expect(src).toContain("new GetJobRunCommand");
  });

  it("binds the job id and reads the status path", () => {
    expect(src).toContain("const jobId = started.JobRunId;");
    expect(src).toContain("status: res.JobRun.JobRunState");
  });

  it("honors the poll interval override", () => {
    expect(src).toContain("delay: { seconds: 15 }");
  });

  it("throws on a terminal failure status", () => {
    expect(src).toContain('"runEtl failed: "');
  });

  it("bounds the poll loop and throws if it never completes", () => {
    // waitStrategy caps on attempt count so it can't poll to the exec timeout.
    expect(src).toMatch(/attempt < \d+ &&/);
    expect(src).toContain("(state: { status?: string }, attempt: number) =>");
    // A non-success terminal (failure or exhausted attempts) throws.
    expect(src).toContain("did not complete within");
  });

  it("binds the node result to a const named after the node", () => {
    expect(src).toContain(
      'const runEtl = await context.runInChildContext("runEtl"',
    );
  });

  it("infers the Glue IAM actions", () => {
    const { statements } = analyzeWorkflowPermissions(glueWorkflow());
    const glue = statements.find((s) => s.source.includes("glue"));
    expect(glue?.actions).toEqual(["glue:GetJobRun", "glue:StartJobRun"]);
  });

  it("contributes to the inferred execution timeout", () => {
    // maxWaitSeconds (2h) + 20% buffer, floored at 60s.
    expect(inferExecutionTimeoutSeconds(glueWorkflow())).toBeGreaterThan(3600);
  });

  it("rejects an unknown integration", () => {
    const wf = glueWorkflow();
    (wf.nodes[1] as Record<string, unknown>).integration = "nope.doesNotExist";
    expect(() => generateHandler(wf)).toThrow(/unknown integration/);
  });
});

import {
  SERVICE_INTEGRATION_LIST,
  getServiceIntegration,
} from "@aws/durable-execution-sdk-js-visual-workflow-model";
import { transformSync } from "esbuild";

/** Build a single-job workflow for an arbitrary integration key. */
function jobWorkflow(integration: string): DarWorkflow {
  return {
    darVersion: "1.0.0",
    name: `${integration}-wf`,
    dependencyMode: "linear",
    nodes: [
      { id: "s", kind: "start", name: "start" },
      {
        id: "j",
        kind: "awsJob",
        name: "job",
        integration,
        startInput: "{ cluster: 'c', JobName: 'n', projectName: 'p' }",
      } as DarWorkflow["nodes"][number],
      { id: "e", kind: "end", name: "end" },
    ],
    edges: [
      { id: "e1", source: "s", target: "j" },
      { id: "e2", source: "j", target: "e" },
    ],
  };
}

describe("every service integration preset", () => {
  for (const preset of SERVICE_INTEGRATION_LIST) {
    describe(preset.key, () => {
      const src = generateHandler(jobWorkflow(preset.key));

      it("imports its SDK client + both commands", () => {
        expect(src).toContain(preset.clientClass);
        expect(src).toContain(preset.start.command);
        expect(src).toContain(preset.poll.command);
        expect(src).toContain(preset.clientPackage);
      });

      it("emits start + poll operations", () => {
        expect(src).toContain('.step("job-start"');
        expect(src).toContain('"job-wait"');
        expect(src).toContain(`new ${preset.start.command}`);
        expect(src).toContain(`new ${preset.poll.command}`);
      });

      it("transpiles to valid JavaScript", () => {
        // Strips the @aws-sdk/durable imports to a transpile (no type-check).
        expect(() =>
          transformSync(src, { loader: "ts", format: "cjs" }),
        ).not.toThrow();
      });

      it("has a resolvable preset", () => {
        expect(getServiceIntegration(preset.key)).toBeDefined();
      });
    });
  }
});
