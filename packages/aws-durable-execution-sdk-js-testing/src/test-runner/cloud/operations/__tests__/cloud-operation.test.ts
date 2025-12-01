import { InvocationType, OperationStatus } from "@aws-sdk/client-lambda";
import { CloudOperation } from "../cloud-operation";
import { OperationWaitManager } from "../../../local/operations/operation-wait-manager";
import { IndexedOperations } from "../../../common/indexed-operations";
import { DurableApiClient } from "../../../common/create-durable-api-client";
import { WaitingOperationStatus } from "../../../types/durable-operation";

describe("CloudOperation", () => {
  const waitManager = new OperationWaitManager();
  const mockIndexedOperations = new IndexedOperations([]);
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

      const checkpointData = {
        operation: {
          Id: "test-id",
          Status: OperationStatus.SUCCEEDED,
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
