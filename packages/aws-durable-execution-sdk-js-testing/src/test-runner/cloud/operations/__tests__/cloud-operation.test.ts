import { InvocationType, OperationStatus } from "@aws-sdk/client-lambda";
import { CloudOperation } from "../cloud-operation";
import { OperationWaitManager } from "../../../local/operations/operation-wait-manager";
import { IndexedOperations } from "../../../common/indexed-operations";
import { DurableApiClient } from "../../../common/create-durable-api-client";
import { WaitingOperationStatus } from "../../../types/durable-operation";
import { OperationEvents } from "../../../common/operations/operation-with-data";

describe("CloudOperation", () => {
  const mockIndexedOperations = new IndexedOperations([]);
  const waitManager = new OperationWaitManager(mockIndexedOperations);
  const mockApiClient: jest.Mocked<DurableApiClient> = {
    sendCallbackSuccess: jest.fn(),
    sendCallbackFailure: jest.fn(),
    sendCallbackHeartbeat: jest.fn(),
  };

  describe("waitForData", () => {
    it("should delegate to parent and return CloudOperation when invocationType is Event", async () => {
      const operation = new CloudOperation(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
        InvocationType.Event,
      );

      const checkpointData: OperationEvents = {
        operation: {
          Id: "test-id",
          Status: OperationStatus.SUCCEEDED,
          Type: undefined,
          StartTimestamp: undefined,
        },
        events: [],
      };

      operation.populateData(checkpointData);

      const result = await operation.waitForData(
        WaitingOperationStatus.COMPLETED,
      );

      expect(result).toBe(operation);
      expect(result).toBeInstanceOf(CloudOperation);
    });

    it("should throw error when invocationType is not Event", async () => {
      const operation = new CloudOperation(
        waitManager,
        mockIndexedOperations,
        mockApiClient,
        InvocationType.RequestResponse,
      );

      await expect(operation.waitForData()).rejects.toThrow(
        "InvocationType.RequestResponse cannot wait for operation data. Use InvocationType.Event to wait for operation data.",
      );
    });
  });
});
