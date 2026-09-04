import {
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
  OperationUpdate,
} from "@aws/durable-execution-sdk-js";
import { validateFetchOperation } from "../validate-fetch-operation";

describe("validateFetchOperation", () => {
  const createOperationUpdate = (
    action: OperationAction,
    fetchOptions: OperationUpdate["FetchOptions"] = {
      Url: "https://example.com",
    },
  ): OperationUpdate => ({
    Action: action,
    Type: OperationType.FETCH,
    Id: "test-id",
    FetchOptions: fetchOptions,
  });

  const createOperation = (status: OperationStatus): Operation => ({
    Status: status,
    Type: OperationType.FETCH,
    Id: "test-id",
    StartTimestamp: undefined,
  });

  describe("START", () => {
    it("accepts starting a fetch that does not exist yet", () => {
      expect(() => {
        validateFetchOperation(
          createOperationUpdate(OperationAction.START),
          undefined,
        );
      }).not.toThrow();
    });

    it("rejects starting a fetch that already exists", () => {
      expect(() => {
        validateFetchOperation(
          createOperationUpdate(OperationAction.START),
          createOperation(OperationStatus.STARTED),
        );
      }).toThrow("Cannot start a FETCH that already exists.");
    });

    it("rejects a fetch with no url, since there is nothing to request", () => {
      expect(() => {
        validateFetchOperation(
          createOperationUpdate(OperationAction.START, { Url: undefined }),
          undefined,
        );
      }).toThrow("Cannot start a FETCH without a Url.");
    });

    it("rejects a fetch with no options at all", () => {
      expect(() => {
        validateFetchOperation(
          {
            Action: OperationAction.START,
            Type: OperationType.FETCH,
            Id: "test-id",
          },
          undefined,
        );
      }).toThrow("Cannot start a FETCH without a Url.");
    });
  });

  describe("CANCEL", () => {
    it("accepts cancelling a started fetch", () => {
      expect(() => {
        validateFetchOperation(
          createOperationUpdate(OperationAction.CANCEL),
          createOperation(OperationStatus.STARTED),
        );
      }).not.toThrow();
    });

    it("rejects cancelling a fetch that does not exist", () => {
      expect(() => {
        validateFetchOperation(
          createOperationUpdate(OperationAction.CANCEL),
          undefined,
        );
      }).toThrow(
        "Cannot cancel a FETCH that does not exist or has already completed.",
      );
    });

    it("rejects cancelling a fetch that already completed", () => {
      expect(() => {
        validateFetchOperation(
          createOperationUpdate(OperationAction.CANCEL),
          createOperation(OperationStatus.SUCCEEDED),
        );
      }).toThrow(
        "Cannot cancel a FETCH that does not exist or has already completed.",
      );
    });
  });

  describe("outcomes the SDK may not request", () => {
    // A fetch is one-sided: the service performs the request, so it is the only party that
    // can say what came back. Accepting these would let an execution fabricate a response.
    it.each([
      OperationAction.SUCCEED,
      OperationAction.FAIL,
      OperationAction.RETRY,
    ])("rejects %s", (action) => {
      expect(() => {
        validateFetchOperation(
          createOperationUpdate(action),
          createOperation(OperationStatus.STARTED),
        );
      }).toThrow("Invalid FETCH action.");
    });
  });
});
