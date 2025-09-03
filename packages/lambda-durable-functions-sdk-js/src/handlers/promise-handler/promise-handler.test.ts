import { createPromiseHandler } from "./promise-handler";

describe("Promise Handler", () => {
  let mockStep: jest.Mock;
  let promiseHandler: ReturnType<typeof createPromiseHandler>;

  beforeEach(() => {
    mockStep = jest.fn();
    promiseHandler = createPromiseHandler(mockStep);
  });

  describe("error deserialization", () => {
    it("should use custom serdes for allSettled to preserve Error objects", async () => {
      const promises = [Promise.resolve(1), Promise.reject(new Error("test"))];
      mockStep.mockImplementation(async (name, fn, config) => {
        // Simulate serialization/deserialization cycle
        const result = await fn();
        const serialized = await config.serdes.serialize(result, {
          entityId: "test",
          durableExecutionArn: "arn",
        });
        return await config.serdes.deserialize(serialized, {
          entityId: "test",
          durableExecutionArn: "arn",
        });
      });

      const result = await promiseHandler.allSettled(promises);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ status: "fulfilled", value: 1 });
      expect(result[1].status).toBe("rejected");
      expect((result[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
      expect((result[1] as PromiseRejectedResult).reason.message).toBe("test");
    });

    it("should use real errorAwareSerdes for allSettled", async () => {
      const promises = [Promise.resolve(1), Promise.reject(new Error("test"))];

      // Spy on step to capture the actual serdes and use it
      mockStep.mockImplementation(async (name, fn, config) => {
        const result = await fn();

        // Actually call the real serdes methods to test them
        if (config?.serdes) {
          const serialized = await config.serdes.serialize(result, {
            entityId: "test",
            durableExecutionArn: "arn",
          });
          expect(serialized).toBeDefined();
          expect(typeof serialized).toBe("string");

          const deserialized = await config.serdes.deserialize(serialized, {
            entityId: "test",
            durableExecutionArn: "arn",
          });
          return deserialized;
        }
        return result;
      });

      const result = await promiseHandler.allSettled(promises);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ status: "fulfilled", value: 1 });
      expect(result[1].status).toBe("rejected");
      expect((result[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
      expect((result[1] as PromiseRejectedResult).reason.message).toBe("test");
    });

    it("should preserve Error properties during serialization cycle", async () => {
      const customError = new TypeError("Custom type error");
      customError.stack = "Custom stack trace";

      const promises = [Promise.resolve(1), Promise.reject(customError)];
      mockStep.mockImplementation(async (name, fn, config) => {
        const result = await fn();
        const serialized = await config.serdes.serialize(result, {
          entityId: "test",
          durableExecutionArn: "arn",
        });
        return await config.serdes.deserialize(serialized, {
          entityId: "test",
          durableExecutionArn: "arn",
        });
      });

      const result = await promiseHandler.allSettled(promises);

      const rejectedResult = result[1] as PromiseRejectedResult;
      expect(rejectedResult.reason).toBeInstanceOf(Error);
      expect(rejectedResult.reason.name).toBe("TypeError");
      expect(rejectedResult.reason.message).toBe("Custom type error");
      expect(rejectedResult.reason.stack).toBe("Custom stack trace");
    });

    it("should handle undefined values in errorAwareSerdes", async () => {
      mockStep.mockImplementation(async (name, fn, config) => {
        // Test the serdes with undefined values
        if (config?.serdes) {
          // Test serialize with undefined
          const serializedUndefined = await config.serdes.serialize(undefined, {
            entityId: "test",
            durableExecutionArn: "arn",
          });
          expect(serializedUndefined).toBeUndefined();

          // Test deserialize with undefined
          const deserializedUndefined = await config.serdes.deserialize(
            undefined,
            { entityId: "test", durableExecutionArn: "arn" },
          );
          expect(deserializedUndefined).toBeUndefined();
        }

        return await fn();
      });

      await promiseHandler.allSettled([Promise.resolve(1)]);
    });

    it("should handle errors without name property", async () => {
      const promises = [Promise.resolve(1), Promise.reject(new Error("test"))];
      mockStep.mockImplementation(async (name, fn, config) => {
        const result = await fn();
        // Manually create a result with an error that has no name property
        const modifiedResult = [
          result[0],
          {
            status: "rejected",
            reason: {
              message: "error without name",
              stack: "some stack",
              // Note: no 'name' property
            },
          },
        ];
        const serialized = await config.serdes.serialize(modifiedResult, {
          entityId: "test",
          durableExecutionArn: "arn",
        });
        return await config.serdes.deserialize(serialized, {
          entityId: "test",
          durableExecutionArn: "arn",
        });
      });

      const result = await promiseHandler.allSettled(promises);

      expect(result).toHaveLength(2);
      expect(result[1].status).toBe("rejected");
      expect((result[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
      expect((result[1] as PromiseRejectedResult).reason.name).toBe("Error"); // Should default to "Error"
      expect((result[1] as PromiseRejectedResult).reason.message).toBe(
        "error without name",
      );
    });

    it("should handle non-array values in errorAwareSerdes", async () => {
      mockStep.mockImplementation(async (name, fn, config) => {
        // Test the serdes with non-array values
        if (config?.serdes) {
          // Test serialize with non-array value
          const nonArrayValue = { someProperty: "value" };
          const serialized = await config.serdes.serialize(nonArrayValue, {
            entityId: "test",
            durableExecutionArn: "arn",
          });
          expect(serialized).toBe(JSON.stringify(nonArrayValue));

          // Test deserialize with non-array value
          const deserialized = await config.serdes.deserialize(serialized, {
            entityId: "test",
            durableExecutionArn: "arn",
          });
          expect(deserialized).toEqual(nonArrayValue);
        }

        return await fn();
      });

      await promiseHandler.allSettled([Promise.resolve(1)]);
    });
  });

  describe("retry behavior", () => {
    it("should configure steps with no-retry strategy", async () => {
      const promises = [Promise.resolve(1), Promise.resolve(2)];
      mockStep.mockResolvedValue([1, 2]);

      await promiseHandler.all(promises);

      expect(mockStep).toHaveBeenCalledWith(
        undefined,
        expect.any(Function),
        expect.objectContaining({
          retryStrategy: expect.any(Function),
        }),
      );

      // Verify the retry strategy returns shouldRetry: false
      const stepConfig = mockStep.mock.calls[0][2];
      const retryDecision = stepConfig.retryStrategy(new Error("test"), 1);
      expect(retryDecision).toEqual({ shouldRetry: false });
    });

    it("should accept undefined as name parameter", async () => {
      const promises = [Promise.resolve(1)];
      mockStep.mockResolvedValue([1]);

      await promiseHandler.all(undefined, promises);

      expect(mockStep).toHaveBeenCalledWith(
        undefined,
        expect.any(Function),
        expect.objectContaining({
          retryStrategy: expect.any(Function),
        }),
      );
    });

    it("should configure named steps with no-retry strategy", async () => {
      const promises = [Promise.resolve(1), Promise.resolve(2)];
      mockStep.mockResolvedValue([1, 2]);

      await promiseHandler.all("test-all", promises);

      expect(mockStep).toHaveBeenCalledWith(
        "test-all",
        expect.any(Function),
        expect.objectContaining({
          retryStrategy: expect.any(Function),
        }),
      );

      // Verify the retry strategy returns shouldRetry: false
      const stepConfig = mockStep.mock.calls[0][2];
      const retryDecision = stepConfig.retryStrategy(new Error("test"), 1);
      expect(retryDecision).toEqual({ shouldRetry: false });
    });
  });

  describe("all", () => {
    it("should call step with Promise.all when no name provided", async () => {
      const promises = [Promise.resolve(1), Promise.resolve(2)];
      mockStep.mockImplementation(async (name, fn) => await fn());

      const result = await promiseHandler.all(promises);

      expect(mockStep).toHaveBeenCalledWith(
        undefined,
        expect.any(Function),
        expect.objectContaining({
          retryStrategy: expect.any(Function),
        }),
      );
      expect(result).toEqual([1, 2]);
    });

    it("should call step with name when name provided", async () => {
      const promises = [Promise.resolve(1), Promise.resolve(2)];
      mockStep.mockImplementation(async (name, fn) => await fn());

      const result = await promiseHandler.all("test-all", promises);

      expect(mockStep).toHaveBeenCalledWith(
        "test-all",
        expect.any(Function),
        expect.any(Object),
      );
      expect(result).toEqual([1, 2]);
    });

    it("should handle rejections correctly (fail fast)", async () => {
      const promises = [
        Promise.resolve(1),
        Promise.reject(new Error("test error")),
      ];
      mockStep.mockImplementation(async (_, fn) => await fn());

      await expect(promiseHandler.all(promises)).rejects.toThrow("test error");
    });
  });

  describe("allSettled", () => {
    it("should call step with Promise.allSettled when no name provided", async () => {
      const promises = [Promise.resolve(1), Promise.resolve(2)];
      const expectedResult = [
        { status: "fulfilled", value: 1 },
        { status: "fulfilled", value: 2 },
      ];
      mockStep.mockResolvedValue(expectedResult);

      await promiseHandler.allSettled(promises);

      expect(mockStep).toHaveBeenCalledWith(
        undefined,
        expect.any(Function),
        expect.objectContaining({
          retryStrategy: expect.any(Function),
        }),
      );
    });

    it("should call step with name when name provided", async () => {
      const promises = [Promise.resolve(1), Promise.resolve(2)];
      mockStep.mockImplementation(async (name, fn) => await fn());

      const result = await promiseHandler.allSettled(
        "test-allSettled",
        promises,
      );

      expect(mockStep).toHaveBeenCalledWith(
        "test-allSettled",
        expect.any(Function),
        expect.any(Object),
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ status: "fulfilled", value: 1 });
      expect(result[1]).toEqual({ status: "fulfilled", value: 2 });
    });

    it("should handle rejections without throwing", async () => {
      const promises = [
        Promise.resolve(1),
        Promise.reject(new Error("test error")),
      ];
      mockStep.mockImplementation(async (name, fn) => await fn());

      const result = await promiseHandler.allSettled(promises);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ status: "fulfilled", value: 1 });
      expect(result[1]).toEqual({
        status: "rejected",
        reason: expect.any(Error),
      });
    });
  });

  describe("any", () => {
    it("should call step with Promise.any when no name provided", async () => {
      const promises = [Promise.resolve(1), Promise.resolve(2)];
      mockStep.mockImplementation(async (name, fn) => await fn());

      const result = await promiseHandler.any(promises);

      expect(mockStep).toHaveBeenCalledWith(
        undefined,
        expect.any(Function),
        expect.objectContaining({
          retryStrategy: expect.any(Function),
        }),
      );
      expect(result).toBe(1); // Promise.any returns the first resolved value
    });

    it("should call step with name when name provided", async () => {
      const promises = [Promise.resolve(1), Promise.resolve(2)];
      mockStep.mockImplementation(async (name, fn) => await fn());

      const result = await promiseHandler.any("test-any", promises);

      expect(mockStep).toHaveBeenCalledWith(
        "test-any",
        expect.any(Function),
        expect.any(Object),
      );
      expect(result).toBe(1); // Promise.any returns the first resolved value
    });

    it("should throw AggregateError when all promises reject", async () => {
      const promises = [
        Promise.reject(new Error("error1")),
        Promise.reject(new Error("error2")),
      ];
      mockStep.mockImplementation(async (name, fn) => await fn());

      await expect(promiseHandler.any(promises)).rejects.toThrow(
        "All promises were rejected",
      );
    });

    it("should return first fulfilled value when some promises succeed", async () => {
      const promises = [
        Promise.reject(new Error("error")),
        Promise.resolve("success"),
      ];
      mockStep.mockImplementation(async (name, fn) => await fn());

      const result = await promiseHandler.any(promises);
      expect(result).toBe("success");
    });
  });

  describe("race", () => {
    it("should call step with Promise.race when no name provided", async () => {
      const promises = [Promise.resolve(1), Promise.resolve(2)];
      mockStep.mockImplementation(async (name, fn) => await fn());

      const result = await promiseHandler.race(promises);

      expect(mockStep).toHaveBeenCalledWith(
        undefined,
        expect.any(Function),
        expect.objectContaining({
          retryStrategy: expect.any(Function),
        }),
      );
      expect(result).toBe(1); // Promise.race returns the first resolved value
    });

    it("should call step with name when name provided", async () => {
      const promises = [Promise.resolve(1), Promise.resolve(2)];
      mockStep.mockImplementation(async (name, fn) => await fn());

      const result = await promiseHandler.race("test-race", promises);

      expect(mockStep).toHaveBeenCalledWith(
        "test-race",
        expect.any(Function),
        expect.any(Object),
      );
      expect(result).toBe(1); // Promise.race returns the first resolved value
    });

    it("should throw error when fastest promise rejects", async () => {
      const promises = [
        Promise.reject(new Error("fast error")),
        new Promise((resolve) =>
          setTimeout(() => resolve("slow success"), 100),
        ),
      ];
      mockStep.mockImplementation(async (name, fn) => await fn());

      await expect(promiseHandler.race(promises)).rejects.toThrow("fast error");
    });

    it("should return value when fastest promise resolves", async () => {
      const promises = [
        Promise.resolve("fast success"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("slow error")), 100),
        ),
      ];
      mockStep.mockImplementation(async (name, fn) => await fn());

      const result = await promiseHandler.race(promises);
      expect(result).toBe("fast success");
    });
  });
});
