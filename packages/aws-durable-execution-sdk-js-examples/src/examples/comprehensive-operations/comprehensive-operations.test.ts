import { handler } from "./comprehensive-operations";
import { createTests } from "../../utils/test-helper";

createTests({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it("should execute all operations successfully", async () => {
      const execution = await runner.run();
      const result = execution.getResult() as any;

      // Verify the structure of the result - now using BatchResult objects
      expect(result.step1).toBe("Step 1 completed successfully");
      expect(result.waitCompleted).toBe(true);

      // mapResults is now a BatchResult object
      expect(result.mapResults.all).toHaveLength(5);
      expect(result.mapResults.all.map((item: any) => item.result)).toEqual([
        1, 2, 3, 4, 5,
      ]);
      expect(result.mapResults.completionReason).toBe("ALL_COMPLETED");

      // parallelResults is now a BatchResult object
      expect(result.parallelResults.all).toHaveLength(3);
      expect(
        result.parallelResults.all.map((item: any) => item.result),
      ).toEqual(["apple", "banana", "orange"]);
      expect(result.parallelResults.completionReason).toBe("ALL_COMPLETED");

      // Summary should use BatchResult objects
      expect(result.summary.totalOperations).toBe(4);
      expect(result.summary.stepResult).toBe("Step 1 completed successfully");
      expect(
        result.summary.numbersProcessed.all.map((item: any) => item.result),
      ).toEqual([1, 2, 3, 4, 5]);
      expect(
        result.summary.fruitsSelected.all.map((item: any) => item.result),
      ).toEqual(["apple", "banana", "orange"]);

      const step1Op = runner.getOperation("step1");

      expect(step1Op).toBeDefined();
      expect(step1Op.getStepDetails()?.result).toBe(
        "Step 1 completed successfully",
      );
      const waitOp = runner.getOperationByIndex(1); // Wait should be the second operation

      expect(waitOp.getWaitDetails()?.waitSeconds).toEqual(1);
      // Verify map results - now BatchResult object
      expect(result.mapResults.all).toHaveLength(5);
      expect(result.mapResults.all.map((item: any) => item.result)).toEqual([
        1, 2, 3, 4, 5,
      ]);

      // Verify individual map step operations exist with correct names
      for (let i = 0; i < 5; i++) {
        const mapStepOp = runner.getOperation(`map-step-${i}`);
        expect(mapStepOp).toBeDefined();
        expect(mapStepOp.getStepDetails()?.result).toBe(i + 1);
      }

      // Verify parallel results - now BatchResult object
      expect(result.parallelResults.all).toHaveLength(3);
      expect(
        result.parallelResults.all.map((item: any) => item.result),
      ).toEqual(["apple", "banana", "orange"]);

      // Verify individual parallel step operations exist
      const fruitStep1Op = runner.getOperation("fruit-step-1");
      const fruitStep2Op = runner.getOperation("fruit-step-2");
      const fruitStep3Op = runner.getOperation("fruit-step-3");

      expect(fruitStep1Op).toBeDefined();
      expect(fruitStep2Op).toBeDefined();
      expect(fruitStep3Op).toBeDefined();

      expect(fruitStep1Op.getStepDetails()?.result).toBe("apple");
      expect(fruitStep2Op.getStepDetails()?.result).toBe("banana");
      expect(fruitStep3Op.getStepDetails()?.result).toBe("orange");

      // Verify summary structure - now using BatchResult objects
      expect(result.summary).toBeDefined();
      expect(result.summary.totalOperations).toBe(4);
      expect(result.summary.stepResult).toBe("Step 1 completed successfully");
      expect(
        result.summary.numbersProcessed.all.map((item: any) => item.result),
      ).toEqual([1, 2, 3, 4, 5]);
      expect(
        result.summary.fruitsSelected.all.map((item: any) => item.result),
      ).toEqual(["apple", "banana", "orange"]);

      // Verify execution completed successfully
      expect(execution.getResult()).toBeDefined();
      expect(execution.getOperations().length).toBeGreaterThan(0);

      assertEventSignatures(execution);
    });
  },
});
