import { handler } from "./map-with-condition";
import { createTests } from "../../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should poll each job until completion and return results", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      expect(result.totalProcessed).toBe(3);
      expect(result.totalFailed).toBe(0);
      expect(result.completionReason).toBe("ALL_COMPLETED");
      expect(result.jobs).toHaveLength(3);

      // Verify each job completed with the correct number of checks
      const fastJob = result.jobs.find((j: any) => j.jobName === "job-fast");
      expect(fastJob.finalStatus).toBe("completed");
      expect(fastJob.totalChecks).toBe(1);

      const mediumJob = result.jobs.find(
        (j: any) => j.jobName === "job-medium",
      );
      expect(mediumJob.finalStatus).toBe("completed");
      expect(mediumJob.totalChecks).toBe(2);

      const slowJob = result.jobs.find((j: any) => j.jobName === "job-slow");
      expect(slowJob.finalStatus).toBe("completed");
      expect(slowJob.totalChecks).toBe(3);

      // Verify the map has 3 child operations
      const mapOp = runner.getOperation("job-pipeline");
      expect(mapOp.getChildOperations()).toHaveLength(3);

      // Verify submit and collect steps exist for each job
      expect(runner.getOperation("submit-job-fast")).toBeDefined();
      expect(runner.getOperation("collect-job-fast")).toBeDefined();
      expect(runner.getOperation("submit-job-medium")).toBeDefined();
      expect(runner.getOperation("collect-job-medium")).toBeDefined();
      expect(runner.getOperation("submit-job-slow")).toBeDefined();
      expect(runner.getOperation("collect-job-slow")).toBeDefined();

      assertEventSignatures(execution);
    });

    it("should handle single job that completes immediately", async () => {
      const execution = await runner.run({
        payload: {
          jobs: [{ id: 99, name: "instant-job", completesAfterChecks: 1 }],
        },
      });
      const result = execution.getResult() as any;

      expect(result.totalProcessed).toBe(1);
      expect(result.totalFailed).toBe(0);
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].finalStatus).toBe("completed");
      expect(result.jobs[0].totalChecks).toBe(1);

      assertEventSignatures(execution, "single-job");
    });

    it("should handle jobs requiring many polling iterations", async () => {
      const execution = await runner.run({
        payload: {
          jobs: [{ id: 1, name: "long-poll-job", completesAfterChecks: 5 }],
        },
      });
      const result = execution.getResult() as any;

      expect(result.totalProcessed).toBe(1);
      expect(result.jobs[0].finalStatus).toBe("completed");
      expect(result.jobs[0].totalChecks).toBe(5);

      assertEventSignatures(execution, "long-poll");
    });
  },
});
