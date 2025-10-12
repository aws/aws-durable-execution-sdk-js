import { createParallelHandler } from "./parallel-handler";
import {
  ExecutionContext,
  DurableContext,
  ParallelFunc,
  NamedParallelBranch,
  BatchItemStatus,
} from "../../types";
import { MockBatchResult } from "../../testing/mock-batch-result";

describe("Parallel Handler", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockExecuteConcurrently: jest.MockedFunction<
    DurableContext["executeConcurrently"]
  >;
  let parallelHandler: ReturnType<typeof createParallelHandler>;

  beforeEach(() => {
    mockExecutionContext = {} as jest.Mocked<ExecutionContext>;
    mockExecuteConcurrently = jest.fn();
    parallelHandler = createParallelHandler(
      mockExecutionContext,
      mockExecuteConcurrently,
    );
  });

  describe("validation", () => {
    it("should throw for non-array branches", async () => {
      await expect(parallelHandler("not-array" as any)).rejects.toThrow(
        "Parallel operation requires an array of branch functions",
      );
    });

    it("should throw for non-function branches", async () => {
      const branches = [jest.fn(), "not-function" as any];
      await expect(parallelHandler(branches as any)).rejects.toThrow(
        "All branches must be functions",
      );
    });
  });

  describe("parameter parsing", () => {
    it("should handle name and branches", async () => {
      const branch1: ParallelFunc<string> = jest
        .fn()
        .mockResolvedValue("result1");
      const branches = [branch1];

      mockExecuteConcurrently.mockResolvedValue(
        new MockBatchResult([
          { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
        ]) as any,
      );

      await parallelHandler("test-name", branches);

      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        "test-name",
        [
          {
            id: "parallel-branch-0",
            data: branch1,
            index: 0,
            name: undefined,
          },
        ],
        expect.any(Function),
        {
          completionConfig: undefined,
          iterationSubType: "ParallelBranch",
          maxConcurrency: undefined,
          summaryGenerator: expect.any(Function),
          topLevelSubType: "Parallel",
        },
      );
    });

    it("should handle branches and config", async () => {
      const branch1: ParallelFunc<string> = jest
        .fn()
        .mockResolvedValue("result1");
      const branches = [branch1];
      const config = { maxConcurrency: 2 };

      mockExecuteConcurrently.mockResolvedValue(
        new MockBatchResult([
          { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
        ]) as any,
      );

      await parallelHandler(branches, config);

      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        undefined,
        [
          {
            id: "parallel-branch-0",
            data: branch1,
            index: 0,
            name: undefined,
          },
        ],
        expect.any(Function),
        {
          completionConfig: undefined,
          iterationSubType: "ParallelBranch",
          maxConcurrency: 2,
          summaryGenerator: expect.any(Function),
          topLevelSubType: "Parallel",
        },
      );
    });

    it("should handle name, branches and config", async () => {
      const branch1: ParallelFunc<string> = jest
        .fn()
        .mockResolvedValue("result1");
      const branches = [branch1];
      const config = { maxConcurrency: 3 };

      mockExecuteConcurrently.mockResolvedValue(
        new MockBatchResult([
          { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
        ]) as any,
      );

      await parallelHandler("test-name", branches, config);

      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        "test-name",
        [
          {
            id: "parallel-branch-0",
            data: branch1,
            index: 0,
            name: undefined,
          },
        ],
        expect.any(Function),
        {
          completionConfig: undefined,
          iterationSubType: "ParallelBranch",
          maxConcurrency: 3,
          summaryGenerator: expect.any(Function),
          topLevelSubType: "Parallel",
        },
      );
    });
  });

  it("should execute parallel branches and return BatchResult", async () => {
    const branch1: ParallelFunc<string> = jest
      .fn()
      .mockResolvedValue("result1");
    const branch2: ParallelFunc<string> = jest
      .fn()
      .mockResolvedValue("result2");
    const branches = [branch1, branch2];

    mockExecuteConcurrently.mockResolvedValue(
      new MockBatchResult([
        { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
        { index: 1, result: "result2", status: BatchItemStatus.SUCCEEDED },
      ]) as any,
    );

    const result = await parallelHandler("test-parallel", branches);

    expect(result.all[0]).toEqual({
      index: 0,
      result: "result1",
      status: BatchItemStatus.SUCCEEDED,
    });
    expect(result.all[1]).toEqual({
      index: 1,
      result: "result2",
      status: BatchItemStatus.SUCCEEDED,
    });
    expect(result.successCount).toBe(2);
  });

  it("should handle empty branches", async () => {
    const branches: ParallelFunc<any>[] = [];

    mockExecuteConcurrently.mockResolvedValue(new MockBatchResult([]) as any);

    const result = await parallelHandler(branches);

    expect(result.all).toEqual([]);
    expect(result.successCount).toBe(0);
  });

  it("should execute executor function with logging", async () => {
    // Set verbose mode for this test
    const originalEnv = process.env.DURABLE_VERBOSE_MODE;
    process.env.DURABLE_VERBOSE_MODE = "true";

    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    const branch1: ParallelFunc<string> = jest
      .fn()
      .mockResolvedValue("result1");
    const branches = [branch1];

    // Mock the executor being called
    let capturedExecutor: any;
    mockExecuteConcurrently.mockImplementation(
      async (
        nameOrItems: any,
        itemsOrExecutor?: any,
        executorOrConfig?: any,
        _maybeConfig?: any,
      ) => {
        // Handle the overloaded signature
        if (typeof nameOrItems === "string" || nameOrItems === undefined) {
          capturedExecutor = executorOrConfig;
        } else {
          capturedExecutor = itemsOrExecutor;
        }
        return new MockBatchResult([
          { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
        ]) as any;
      },
    );

    await parallelHandler("test-parallel", branches);

    // Call the captured executor to test its logging
    const mockChildContext = {} as any;
    const executionItem = {
      id: "parallel-branch-0",
      data: branch1,
      index: 0,
      name: undefined,
    };
    await capturedExecutor(executionItem, mockChildContext);

    // Verify the executor logging was called
    expect(consoleSpy).toHaveBeenCalledWith(
      "🔀 Processing parallel branch:",
      expect.stringContaining('"index": 0'),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "✅ Parallel branch completed:",
      expect.stringContaining('"index": 0'),
    );

    consoleSpy.mockRestore();

    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env.DURABLE_VERBOSE_MODE = originalEnv;
    } else {
      delete process.env.DURABLE_VERBOSE_MODE;
    }
  });

  describe("named branches", () => {
    it("should handle named parallel branches", async () => {
      const namedBranch: NamedParallelBranch<string> = {
        name: "custom-branch",
        func: jest.fn().mockResolvedValue("result1"),
      };
      const branches = [namedBranch];

      mockExecuteConcurrently.mockResolvedValue(
        new MockBatchResult([
          { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
        ]) as any,
      );

      await parallelHandler("test-name", branches);

      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        "test-name",
        [
          {
            id: "parallel-branch-0",
            data: namedBranch.func,
            index: 0,
            name: "custom-branch",
          },
        ],
        expect.any(Function),
        {
          completionConfig: undefined,
          iterationSubType: "ParallelBranch",
          maxConcurrency: undefined,
          summaryGenerator: expect.any(Function),
          topLevelSubType: "Parallel",
        },
      );
    });

    it("should handle mixed named and unnamed branches", async () => {
      const namedBranch: NamedParallelBranch<string> = {
        name: "named-branch",
        func: jest.fn().mockResolvedValue("result1"),
      };
      const unnamedBranch: ParallelFunc<string> = jest
        .fn()
        .mockResolvedValue("result2");
      const branches = [namedBranch, unnamedBranch];

      mockExecuteConcurrently.mockResolvedValue(
        new MockBatchResult([
          { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
          { index: 1, result: "result2", status: BatchItemStatus.SUCCEEDED },
        ]) as any,
      );

      await parallelHandler(branches);

      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        undefined,
        [
          {
            id: "parallel-branch-0",
            data: namedBranch.func,
            index: 0,
            name: "named-branch",
          },
          {
            id: "parallel-branch-1",
            data: unnamedBranch,
            index: 1,
            name: undefined,
          },
        ],
        expect.any(Function),
        {
          completionConfig: undefined,
          iterationSubType: "ParallelBranch",
          maxConcurrency: undefined,
          summaryGenerator: expect.any(Function),
          topLevelSubType: "Parallel",
        },
      );
    });

    it("should use undefined names for unnamed branches", async () => {
      const branch1: ParallelFunc<string> = jest
        .fn()
        .mockResolvedValue("result1");
      const branch2: ParallelFunc<string> = jest
        .fn()
        .mockResolvedValue("result2");
      const branches = [branch1, branch2];

      mockExecuteConcurrently.mockResolvedValue(
        new MockBatchResult([
          { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
          { index: 1, result: "result2", status: BatchItemStatus.SUCCEEDED },
        ]) as any,
      );

      await parallelHandler(branches);

      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        undefined,
        [
          {
            id: "parallel-branch-0",
            data: branch1,
            index: 0,
            name: undefined,
          },
          {
            id: "parallel-branch-1",
            data: branch2,
            index: 1,
            name: undefined,
          },
        ],
        expect.any(Function),
        {
          completionConfig: undefined,
          iterationSubType: "ParallelBranch",
          maxConcurrency: undefined,
          summaryGenerator: expect.any(Function),
          topLevelSubType: "Parallel",
        },
      );
    });
  });
});
