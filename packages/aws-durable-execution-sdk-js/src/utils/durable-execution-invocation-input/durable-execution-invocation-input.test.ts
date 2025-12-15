import { Operation } from "@aws-sdk/client-lambda";
import { DurableExecutionInvocationInput } from "../../types";
import { DurableExecutionClient } from "../../types/durable-execution";
import { DurableExecutionInvocationInputWithClient } from "./durable-execution-invocation-input";

describe("DurableExecutionInvocationInputWithClient", () => {
  let mockDurableExecutionClient: DurableExecutionClient;
  let basicInvocationInput: DurableExecutionInvocationInput;

  beforeEach(() => {
    mockDurableExecutionClient = {
      getExecutionState: jest.fn(),
      checkpoint: jest.fn(),
    };

    basicInvocationInput = {
      DurableExecutionArn:
        "arn:aws:lambda:us-east-1:123456789012:function:test-function",
      CheckpointToken: "checkpoint-token-123",
      InitialExecutionState: {
        Operations: [],
      },
    };
  });

  describe("constructor", () => {
    it("should assign all properties from DurableExecutionInvocationInput parameters", () => {
      const invocationInput: DurableExecutionInvocationInput = {
        DurableExecutionArn:
          "arn:aws:lambda:us-west-2:987654321098:function:my-function",
        CheckpointToken: "my-checkpoint-token",
        InitialExecutionState: {
          Operations: [
            {
              Id: "step-1",
              Type: "STEP",
              Status: "SUCCEEDED",
            } as Operation,
          ],
          NextMarker: "next-marker-value",
        },
      };

      const instance = new DurableExecutionInvocationInputWithClient(
        invocationInput,
        mockDurableExecutionClient,
      );

      expect(instance.DurableExecutionArn).toBe(
        invocationInput.DurableExecutionArn,
      );
      expect(instance.CheckpointToken).toBe(invocationInput.CheckpointToken);
      expect(instance.InitialExecutionState).toEqual(
        invocationInput.InitialExecutionState,
      );
      expect(instance.durableExecutionClient).toBe(mockDurableExecutionClient);
    });

    it("should handle InitialExecutionState without NextMarker", () => {
      const invocationInput: DurableExecutionInvocationInput = {
        ...basicInvocationInput,
        InitialExecutionState: {
          Operations: [
            {
              Id: "step-1",
              Type: "STEP",
              Status: "SUCCEEDED",
            } as Operation,
          ],
          // NextMarker is undefined
        },
      };

      const instance = new DurableExecutionInvocationInputWithClient(
        invocationInput,
        mockDurableExecutionClient,
      );

      expect(instance.InitialExecutionState.NextMarker).toBeUndefined();
      expect(instance.InitialExecutionState.Operations).toEqual(
        invocationInput.InitialExecutionState.Operations,
      );
    });

    it("should handle empty Operations array", () => {
      const instance = new DurableExecutionInvocationInputWithClient(
        basicInvocationInput,
        mockDurableExecutionClient,
      );

      expect(instance.InitialExecutionState.Operations).toEqual([]);
      expect(instance.InitialExecutionState.NextMarker).toBeUndefined();
    });

    it("should handle complex Operations array", () => {
      const operations: Operation[] = [
        {
          Id: "step-1",
          Type: "STEP",
          Status: "SUCCEEDED",
          SubType: "Step",
          Output: '{"result": "value1"}',
          StartTimestamp: new Date("2023-01-01T10:00:00Z"),
          EndTimestamp: new Date("2023-01-01T10:01:00Z"),
        } as Operation,
        {
          Id: "callback-1",
          Type: "CALLBACK",
          Status: "PENDING",
          SubType: "Callback",
          StartTimestamp: new Date("2023-01-01T10:01:30Z"),
        } as Operation,
      ];

      const invocationInput: DurableExecutionInvocationInput = {
        ...basicInvocationInput,
        InitialExecutionState: {
          Operations: operations,
          NextMarker: "pagination-token",
        },
      };

      const instance = new DurableExecutionInvocationInputWithClient(
        invocationInput,
        mockDurableExecutionClient,
      );

      expect(instance.InitialExecutionState.Operations).toEqual(operations);
      expect(instance.InitialExecutionState.NextMarker).toBe(
        "pagination-token",
      );
    });
  });

  describe("isInstance", () => {
    it("should return true for DurableExecutionInvocationInputWithClient instances", () => {
      const instance = new DurableExecutionInvocationInputWithClient(
        basicInvocationInput,
        mockDurableExecutionClient,
      );

      expect(
        DurableExecutionInvocationInputWithClient.isInstance(instance),
      ).toBe(true);
    });

    it("should return false for regular DurableExecutionInvocationInput objects", () => {
      const regularInput: DurableExecutionInvocationInput = {
        ...basicInvocationInput,
      };

      expect(
        DurableExecutionInvocationInputWithClient.isInstance(regularInput),
      ).toBe(false);
    });

    it("should return false for objects with durableExecutionClient but wrong toString", () => {
      const fakeInstance = {
        ...basicInvocationInput,
        durableExecutionClient: mockDurableExecutionClient,
        toString: (): string => "[object SomeOtherClass]",
      };

      expect(
        DurableExecutionInvocationInputWithClient.isInstance(fakeInstance),
      ).toBe(false);
    });

    it("should return false for objects with correct toString but no durableExecutionClient", () => {
      const fakeInstance = {
        ...basicInvocationInput,
        toString: (): string =>
          "[object DurableExecutionInvocationInputWithClient]",
      };

      expect(
        DurableExecutionInvocationInputWithClient.isInstance(fakeInstance),
      ).toBe(false);
    });

    it("should return false for objects with correct toString and durableExecutionClient but wrong constructor name", () => {
      const fakeInstance = {
        ...basicInvocationInput,
        durableExecutionClient: mockDurableExecutionClient,
        toString: (): string =>
          "[object DurableExecutionInvocationInputWithClient]",
        constructor: { name: "SomeOtherClass" },
      };

      expect(
        DurableExecutionInvocationInputWithClient.isInstance(fakeInstance),
      ).toBe(false);
    });

    it("should return true for objects with all required properties and correct constructor name", () => {
      const validFakeInstance = {
        ...basicInvocationInput,
        durableExecutionClient: mockDurableExecutionClient,
        toString: (): string =>
          "[object DurableExecutionInvocationInputWithClient]",
        constructor: { name: "DurableExecutionInvocationInputWithClient" },
      };

      expect(
        DurableExecutionInvocationInputWithClient.isInstance(validFakeInstance),
      ).toBe(true);
    });

    it("should return false for primitive values", () => {
      expect(DurableExecutionInvocationInputWithClient.isInstance(null)).toBe(
        false,
      );
      expect(
        DurableExecutionInvocationInputWithClient.isInstance(undefined),
      ).toBe(false);
      expect(
        DurableExecutionInvocationInputWithClient.isInstance("string"),
      ).toBe(false);
      expect(DurableExecutionInvocationInputWithClient.isInstance(42)).toBe(
        false,
      );
      expect(DurableExecutionInvocationInputWithClient.isInstance(true)).toBe(
        false,
      );
    });
  });

  describe("Symbol.toStringTag", () => {
    it("should return correct class name for toString() behavior", () => {
      const instance = new DurableExecutionInvocationInputWithClient(
        basicInvocationInput,
        mockDurableExecutionClient,
      );

      expect(instance.toString()).toBe(
        "[object DurableExecutionInvocationInputWithClient]",
      );
    });

    it("should return correct value from Symbol.toStringTag property", () => {
      const instance = new DurableExecutionInvocationInputWithClient(
        basicInvocationInput,
        mockDurableExecutionClient,
      );

      expect(instance[Symbol.toStringTag]).toBe(
        "DurableExecutionInvocationInputWithClient",
      );
    });
  });
});
