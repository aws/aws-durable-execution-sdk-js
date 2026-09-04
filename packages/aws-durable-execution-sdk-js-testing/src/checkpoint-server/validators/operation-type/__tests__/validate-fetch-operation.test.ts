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

  describe("actions the service does not offer", () => {
    // A fetch is one-sided: the service performs the request, so it is the only party that
    // can say what came back. Accepting SUCCEED or FAIL would let an execution fabricate a
    // response. CANCEL is rejected because the real backend does not offer it either --
    // `VALID_ACTIONS_FOR_CHAINED_INVOKE` in DurableExecutionsWorkerService is START alone.
    it.each([
      OperationAction.SUCCEED,
      OperationAction.FAIL,
      OperationAction.RETRY,
      OperationAction.CANCEL,
    ])("rejects %s", (action) => {
      expect(() => {
        validateFetchOperation(
          createOperationUpdate(action),
          createOperation(OperationStatus.STARTED),
        );
      }).toThrow("Invalid FETCH action.");
    });

    it("rejects CANCEL even for an in-flight fetch", () => {
      expect(() => {
        validateFetchOperation(
          createOperationUpdate(OperationAction.CANCEL),
          createOperation(OperationStatus.PENDING),
        );
      }).toThrow("Invalid FETCH action.");
    });
  });
});
