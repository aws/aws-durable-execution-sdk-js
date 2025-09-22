import { LocalDurableTestRunner } from "aws-durable-execution-sdk-js-testing";
import { handler } from "../comprehensive-operations";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("comprehensive-operations test", () => {
    const durableTestRunner = new LocalDurableTestRunner({
        handlerFunction: handler,
        skipTime: true,
    });

    it("should execute all operations successfully", async () => {
        const execution = await durableTestRunner.run();
        const result = execution.getResult() as any;

        // Verify the structure of the result - now using BatchResult objects
        expect(result.step1).toBe("Step 1 completed successfully");
        expect(result.waitCompleted).toBe(true);

        // mapResults is now a BatchResult object
        expect(result.mapResults.all).toHaveLength(5);
        expect(result.mapResults.all.map((item: any) => item.result)).toEqual([1, 2, 3, 4, 5]);
        expect(result.mapResults.completionReason).toBe("ALL_COMPLETED");

        // parallelResults is now a BatchResult object
        expect(result.parallelResults.all).toHaveLength(3);
        expect(result.parallelResults.all.map((item: any) => item.result)).toEqual(["apple", "banana", "orange"]);
        expect(result.parallelResults.completionReason).toBe("ALL_COMPLETED");

        // Summary should use BatchResult objects
        expect(result.summary.totalOperations).toBe(4);
        expect(result.summary.stepResult).toBe("Step 1 completed successfully");
        expect(result.summary.numbersProcessed.all.map((item: any) => item.result)).toEqual([1, 2, 3, 4, 5]);
        expect(result.summary.fruitsSelected.all.map((item: any) => item.result)).toEqual(["apple", "banana", "orange"]);
    });

    it("should execute step1 operation correctly", async () => {
        const step1Op = durableTestRunner.getOperation("step1");

        await durableTestRunner.run();

        expect(step1Op).toBeDefined();
        expect(step1Op.getStepDetails()?.result).toBe(
            "Step 1 completed successfully"
        );
    });

    it("should execute wait operation for 5 seconds", async () => {
        const waitOp = durableTestRunner.getOperationByIndex(1); // Wait should be the second operation

        await durableTestRunner.run();

        expect(waitOp.getWaitDetails()?.waitSeconds).toEqual(5);
    });

    it("should execute map operation with detailed steps", async () => {
        const execution = await durableTestRunner.run();
        const result = execution.getResult() as any;

        // Verify map results - now BatchResult object
        expect(result.mapResults.all).toHaveLength(5);
        expect(result.mapResults.all.map((item: any) => item.result)).toEqual([1, 2, 3, 4, 5]);

        // Verify individual map step operations exist with correct names
        for (let i = 0; i < 5; i++) {
            const mapStepOp = durableTestRunner.getOperation(`map-step-${i}`);
            expect(mapStepOp).toBeDefined();
            expect(mapStepOp.getStepDetails()?.result).toBe(i + 1);
        }
    });

    it("should execute parallel operations with fruit names", async () => {
        const execution = await durableTestRunner.run();
        const result = execution.getResult() as any;

        // Verify parallel results - now BatchResult object
        expect(result.parallelResults.all).toHaveLength(3);
        expect(result.parallelResults.all.map((item: any) => item.result)).toEqual(["apple", "banana", "orange"]);

        // Verify individual parallel step operations exist
        const fruitStep1Op = durableTestRunner.getOperation("fruit-step-1");
        const fruitStep2Op = durableTestRunner.getOperation("fruit-step-2");
        const fruitStep3Op = durableTestRunner.getOperation("fruit-step-3");

        expect(fruitStep1Op).toBeDefined();
        expect(fruitStep2Op).toBeDefined();
        expect(fruitStep3Op).toBeDefined();

        expect(fruitStep1Op.getStepDetails()?.result).toBe("apple");
        expect(fruitStep2Op.getStepDetails()?.result).toBe("banana");
        expect(fruitStep3Op.getStepDetails()?.result).toBe("orange");
    });

    it("should create comprehensive summary object", async () => {
        const execution = await durableTestRunner.run();
        const result = execution.getResult() as any;

        // Verify summary structure - now using BatchResult objects
        expect(result.summary).toBeDefined();
        expect(result.summary.totalOperations).toBe(4);
        expect(result.summary.stepResult).toBe("Step 1 completed successfully");
        expect(result.summary.numbersProcessed.all.map((item: any) => item.result)).toEqual([1, 2, 3, 4, 5]);
        expect(result.summary.fruitsSelected.all.map((item: any) => item.result)).toEqual(["apple", "banana", "orange"]);
    });

    it("should complete execution without errors", async () => {
        const execution = await durableTestRunner.run();

        // Verify execution completed successfully
        expect(execution.getResult()).toBeDefined();
        expect(execution.getOperations().length).toBeGreaterThan(0);
    });
});