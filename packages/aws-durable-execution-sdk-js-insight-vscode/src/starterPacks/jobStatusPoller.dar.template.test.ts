import { resolveJobStatusPollerDar } from "./assets/jobStatusPoller.dar.template";
import { validateDarJson } from "../agent";

// This pack's workflow uses dag dependency mode, which is gated because the
// generated code calls a runtime the SDK does not implement yet. Opting in here
// keeps the template's resolution + validation covered while the gate protects
// real deploys.
process.env.DAR_ALLOW_DAG_MODE = "1";

describe("JobStatusPoller .dar template", () => {
  it("resolves placeholders and produces a valid .dar", async () => {
    const dar = resolveJobStatusPollerDar({
      region: "us-east-1",
      submitJobFunctionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:SubmitJobFunction",
      checkJobFunctionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:CheckJobFunction",
      jobQueueArn:
        "arn:aws:batch:us-east-1:123456789012:job-queue/SampleJobQueue",
      jobDefinition: "SampleJobDefinition",
    });

    expect(dar).not.toContain("{{");

    const { errors } = await validateDarJson(dar);
    expect(errors).toEqual([]);
  }, 30_000);
});
