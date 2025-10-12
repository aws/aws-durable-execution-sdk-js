import { createMapHandler } from "./map-handler";
import {
  ExecutionContext,
  DurableContext,
  MapFunc,
  BatchItemStatus,
} from "../../types";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { MockBatchResult } from "../../testing/mock-batch-result";

describe("Map Handler", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockExecuteConcurrently: jest.MockedFunction<
    DurableContext["executeConcurrently"]
  >;
  let mapHandler: ReturnType<typeof createMapHandler>;

  beforeEach(() => {
    mockExecutionContext = {} as jest.Mocked<ExecutionContext>;

    mockExecuteConcurrently = jest.fn();
    mapHandler = createMapHandler(
      mockExecutionContext,
      mockExecuteConcurrently,
    );
  });

  describe("parameter parsing", () => {
    it("should parse parameters with name", async () => {
      const items = ["item1", "item2"];
      const mapFunc: MapFunc<string, string> = jest
        .fn()
        .mockResolvedValue("result");

      const mockResult = new MockBatchResult([
        { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
        { index: 1, result: "result2", status: BatchItemStatus.SUCCEEDED },
      ]);
      mockExecuteConcurrently.mockResolvedValue(mockResult as any);

      await mapHandler("test-map", items, mapFunc);

      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        "test-map",
        [
          { id: "map-item-0", data: "item1", index: 0, name: undefined },
          { id: "map-item-1", data: "item2", index: 1, name: undefined },
        ],
        expect.any(Function),
        {
          ...{
            ...TEST_CONSTANTS.DEFAULT_MAP_CONFIG,
            summaryGenerator: expect.any(Function),
            completionConfig: undefined,
          },
          summaryGenerator: expect.any(Function),
          completionConfig: undefined,
        },
      );
    });

    it("should parse parameters without name", async () => {
      const items = ["item1", "item2"];
      const mapFunc: MapFunc<string, string> = jest
        .fn()
        .mockResolvedValue("result");

      const mockResult = new MockBatchResult([
        { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
        { index: 1, result: "result2", status: BatchItemStatus.SUCCEEDED },
      ]);
      mockExecuteConcurrently.mockResolvedValue(mockResult as any);

      await mapHandler(items, mapFunc);

      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        undefined,
        [
          { id: "map-item-0", data: "item1", index: 0, name: undefined },
          { id: "map-item-1", data: "item2", index: 1, name: undefined },
        ],
        expect.any(Function),
        {
          ...TEST_CONSTANTS.DEFAULT_MAP_CONFIG,
          summaryGenerator: expect.any(Function),
          completionConfig: undefined,
        },
      );
    });

    it("should accept undefined as name parameter", async () => {
      const items = ["item"];
      const mapFunc: MapFunc<string, string> = jest.fn();

      const mockResult = new MockBatchResult([
        { index: 0, result: "result", status: BatchItemStatus.SUCCEEDED },
      ]);
      mockExecuteConcurrently.mockResolvedValue(mockResult as any);

      await mapHandler(undefined, items, mapFunc);

      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        undefined,
        [{ id: "map-item-0", data: "item", index: 0, name: undefined }],
        expect.any(Function),
        {
          ...TEST_CONSTANTS.DEFAULT_MAP_CONFIG,
          summaryGenerator: expect.any(Function),
          completionConfig: undefined,
        },
      );
    });

    it("should parse parameters with config", async () => {
      const items = ["item1", "item2"];
      const mapFunc: MapFunc<string, string> = jest
        .fn()
        .mockResolvedValue("result");
      const config = {
        ...{
          ...TEST_CONSTANTS.DEFAULT_MAP_CONFIG,
          summaryGenerator: expect.any(Function),
          completionConfig: undefined,
        },
        maxConcurrency: 2,
      };

      const mockResult = new MockBatchResult([
        { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
        { index: 1, result: "result2", status: BatchItemStatus.SUCCEEDED },
      ]);
      mockExecuteConcurrently.mockResolvedValue(mockResult as any);

      await mapHandler(items, mapFunc, config);

      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        undefined,
        [
          { id: "map-item-0", data: "item1", index: 0, name: undefined },
          { id: "map-item-1", data: "item2", index: 1, name: undefined },
        ],
        expect.any(Function),
        {
          ...{
            ...TEST_CONSTANTS.DEFAULT_MAP_CONFIG,
            summaryGenerator: expect.any(Function),
            completionConfig: undefined,
          },
          maxConcurrency: 2,
        },
      );
    });
  });

  describe("validation", () => {
    it("should throw error for non-array items", async () => {
      const mapFunc: MapFunc<string, string> = jest.fn();

      await expect(mapHandler("not-an-array" as any, mapFunc)).rejects.toThrow(
        "Map operation requires an array of items",
      );
    });

    it("should throw error for non-function mapFunc", async () => {
      const items = ["item1", "item2"];

      await expect(mapHandler(items, "not-a-function" as any)).rejects.toThrow(
        "Map operation requires a function to process items",
      );
    });
  });

  describe("execution", () => {
    it("should handle empty array", async () => {
      const items: string[] = [];
      const mapFunc: MapFunc<string, string> = jest.fn();

      const mockResult = new MockBatchResult([]);
      mockExecuteConcurrently.mockResolvedValue(mockResult as any);

      const result = await mapHandler(items, mapFunc);

      expect(result.all).toEqual([]);
      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        undefined,
        [],
        expect.any(Function),
        {
          ...TEST_CONSTANTS.DEFAULT_MAP_CONFIG,
          summaryGenerator: expect.any(Function),
          completionConfig: undefined,
        },
      );
    });

    it("should create correct execution items", async () => {
      const items = ["item1", "item2", "item3"];
      const mapFunc: MapFunc<string, string> = jest
        .fn()
        .mockResolvedValue("result");

      const mockResult = new MockBatchResult([
        { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
        { index: 1, result: "result2", status: BatchItemStatus.SUCCEEDED },
        { index: 2, result: "result3", status: BatchItemStatus.SUCCEEDED },
      ]);
      mockExecuteConcurrently.mockResolvedValue(mockResult as any);

      await mapHandler(items, mapFunc);

      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        undefined,
        [
          { id: "map-item-0", data: "item1", index: 0, name: undefined },
          { id: "map-item-1", data: "item2", index: 1, name: undefined },
          { id: "map-item-2", data: "item3", index: 2, name: undefined },
        ],
        expect.any(Function),
        {
          ...TEST_CONSTANTS.DEFAULT_MAP_CONFIG,
          summaryGenerator: expect.any(Function),
          completionConfig: undefined,
        },
      );
    });

    it("should return BatchResult with correct structure", async () => {
      const items = ["item1", "item2"];
      const mapFunc: MapFunc<string, string> = jest
        .fn()
        .mockResolvedValueOnce("result1")
        .mockResolvedValueOnce("result2");

      const mockResult = new MockBatchResult([
        { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
        { index: 1, result: "result2", status: BatchItemStatus.SUCCEEDED },
      ]);
      mockExecuteConcurrently.mockResolvedValue(mockResult as any);

      const result = await mapHandler(items, mapFunc);

      expect(result.getResults()).toEqual(["result1", "result2"]);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.status).toBe(BatchItemStatus.SUCCEEDED);
    });

    it("should create executor that calls mapFunc correctly", async () => {
      const items = ["item1", "item2"];
      const mapFunc: MapFunc<string, string> = jest
        .fn()
        .mockResolvedValueOnce("result1")
        .mockResolvedValueOnce("result2");

      mockExecuteConcurrently.mockImplementation(async (...args: any[]) => {
        const [, executionItems, executor] = args;

        // Simulate calling the executor for each item
        const results = [];
        for (let i = 0; i < executionItems.length; i++) {
          const item = executionItems[i];
          const mockChildContext = {} as DurableContext;
          const result = await (executor as any)(item, mockChildContext);
          results.push({
            index: i,
            result,
            status: BatchItemStatus.SUCCEEDED as const,
          });
        }
        return new MockBatchResult(results) as any;
      });

      const result = await mapHandler(items, mapFunc);

      expect(result.getResults()).toEqual(["result1", "result2"]);
      expect(mapFunc).toHaveBeenCalledTimes(2);
      expect(mapFunc).toHaveBeenCalledWith(
        expect.any(Object),
        "item1",
        0,
        items,
      );
      expect(mapFunc).toHaveBeenCalledWith(
        expect.any(Object),
        "item2",
        1,
        items,
      );
    });

    it("should pass through maxConcurrency config", async () => {
      const items = ["item1", "item2"];
      const mapFunc: MapFunc<string, string> = jest
        .fn()
        .mockResolvedValue("result");
      const config = {
        ...{
          ...TEST_CONSTANTS.DEFAULT_MAP_CONFIG,
          summaryGenerator: expect.any(Function),
          completionConfig: undefined,
        },
        maxConcurrency: 5,
      };

      const mockResult = new MockBatchResult([
        { index: 0, result: "result1", status: BatchItemStatus.SUCCEEDED },
        { index: 1, result: "result2", status: BatchItemStatus.SUCCEEDED },
      ]);
      mockExecuteConcurrently.mockResolvedValue(mockResult as any);

      await mapHandler("test-map", items, mapFunc, config);

      expect(mockExecuteConcurrently).toHaveBeenCalledWith(
        "test-map",
        expect.any(Array),
        expect.any(Function),
        config,
      );
    });

    describe("itemNamer functionality", () => {
      it("should use custom itemNamer when provided", async () => {
        const items = [
          { id: "user1", name: "Alice" },
          { id: "user2", name: "Bob" },
        ];
        const mapFunc: MapFunc<{ id: string; name: string }, string> = jest
          .fn()
          .mockResolvedValue("processed");
        const itemNamer = (item: any, index: number) => `User-${item.id}`;

        const mockResult = new MockBatchResult([
          { index: 0, result: "processed", status: BatchItemStatus.SUCCEEDED },
          { index: 1, result: "processed", status: BatchItemStatus.SUCCEEDED },
        ]);
        mockExecuteConcurrently.mockResolvedValue(mockResult as any);

        await mapHandler(items, mapFunc, { itemNamer });

        expect(mockExecuteConcurrently).toHaveBeenCalledWith(
          undefined,
          [
            { id: "map-item-0", data: items[0], index: 0, name: "User-user1" },
            { id: "map-item-1", data: items[1], index: 1, name: "User-user2" },
          ],
          expect.any(Function),
          {
            ...TEST_CONSTANTS.DEFAULT_MAP_CONFIG,
            summaryGenerator: expect.any(Function),
            completionConfig: undefined,
          },
        );
      });

      it("should use undefined names when itemNamer is not provided", async () => {
        const items = ["item1", "item2"];
        const mapFunc: MapFunc<string, string> = jest
          .fn()
          .mockResolvedValue("processed");

        const mockResult = new MockBatchResult([
          { index: 0, result: "processed", status: BatchItemStatus.SUCCEEDED },
          { index: 1, result: "processed", status: BatchItemStatus.SUCCEEDED },
        ]);
        mockExecuteConcurrently.mockResolvedValue(mockResult as any);

        await mapHandler(items, mapFunc);

        expect(mockExecuteConcurrently).toHaveBeenCalledWith(
          undefined,
          [
            { id: "map-item-0", data: "item1", index: 0, name: undefined },
            { id: "map-item-1", data: "item2", index: 1, name: undefined },
          ],
          expect.any(Function),
          {
            ...TEST_CONSTANTS.DEFAULT_MAP_CONFIG,
            summaryGenerator: expect.any(Function),
            completionConfig: undefined,
          },
        );
      });

      it("should pass item and index to itemNamer", async () => {
        const items = ["a", "b", "c"];
        const mapFunc: MapFunc<string, string> = jest
          .fn()
          .mockResolvedValue("processed");
        const itemNamer = jest.fn(
          (item: string, index: number) => `${item}-${index}`,
        );

        const mockResult = new MockBatchResult([
          { index: 0, result: "processed", status: BatchItemStatus.SUCCEEDED },
          { index: 1, result: "processed", status: BatchItemStatus.SUCCEEDED },
          { index: 2, result: "processed", status: BatchItemStatus.SUCCEEDED },
        ]);
        mockExecuteConcurrently.mockResolvedValue(mockResult as any);

        await mapHandler(items, mapFunc, { itemNamer });

        expect(itemNamer).toHaveBeenCalledWith("a", 0);
        expect(itemNamer).toHaveBeenCalledWith("b", 1);
        expect(itemNamer).toHaveBeenCalledWith("c", 2);

        expect(mockExecuteConcurrently).toHaveBeenCalledWith(
          undefined,
          [
            { id: "map-item-0", data: "a", index: 0, name: "a-0" },
            { id: "map-item-1", data: "b", index: 1, name: "b-1" },
            { id: "map-item-2", data: "c", index: 2, name: "c-2" },
          ],
          expect.any(Function),
          {
            ...TEST_CONSTANTS.DEFAULT_MAP_CONFIG,
            summaryGenerator: expect.any(Function),
            completionConfig: undefined,
          },
        );
      });
    });
  });
});
