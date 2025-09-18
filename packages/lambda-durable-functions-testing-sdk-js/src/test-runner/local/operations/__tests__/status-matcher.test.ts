import { OperationStatus } from "@aws-sdk/client-lambda";
import { WaitingOperationStatus } from "../../../durable-test-runner";
import { doesStatusMatch } from "../status-matcher";

describe("doesStatusMatch", () => {
  describe("when expectedStatus is STARTED", () => {
    const expectedStatus = WaitingOperationStatus.STARTED;

    it.each(Object.values(OperationStatus))(
      "should return true for all operation statuses: %s",
      (operationStatus) => {
        const result = doesStatusMatch(operationStatus, expectedStatus);
        expect(result).toBe(true);
      }
    );

    it("should return false when status is undefined", () => {
      const result = doesStatusMatch(undefined, expectedStatus);
      expect(result).toBe(false);
    });

    it("should return false when status is null", () => {
      const result = doesStatusMatch(
        null as unknown as OperationStatus,
        expectedStatus
      );
      expect(result).toBe(false);
    });
  });

  describe("when expectedStatus is COMPLETED", () => {
    const expectedStatus = WaitingOperationStatus.COMPLETED;

    it.each([
      OperationStatus.CANCELLED,
      OperationStatus.FAILED,
      OperationStatus.STOPPED,
      OperationStatus.SUCCEEDED,
      OperationStatus.TIMED_OUT,
    ])("should return true for completed status: %s", (operationStatus) => {
      const result = doesStatusMatch(operationStatus, expectedStatus);
      expect(result).toBe(true);
    });

    it.each([
      OperationStatus.STARTED,
      OperationStatus.READY,
      OperationStatus.PENDING,
    ])(
      "should return false for non-completed status: %s",
      (operationStatus) => {
        const result = doesStatusMatch(operationStatus, expectedStatus);
        expect(result).toBe(false);
      }
    );

    it("should return false when status is undefined", () => {
      const result = doesStatusMatch(undefined, expectedStatus);
      expect(result).toBe(false);
    });

    it("should return false when status is null", () => {
      const result = doesStatusMatch(
        null as unknown as OperationStatus,
        expectedStatus
      );
      expect(result).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle all possible OperationStatus values correctly", () => {
      // Test that all STARTED statuses resolve STARTED
      const startedStatuses = Object.values(OperationStatus);
      startedStatuses.forEach((status) => {
        expect(doesStatusMatch(status, WaitingOperationStatus.STARTED)).toBe(
          true
        );
      });

      // Test that only completed statuses resolve COMPLETED
      const completedStatuses = [
        OperationStatus.CANCELLED,
        OperationStatus.FAILED,
        OperationStatus.STOPPED,
        OperationStatus.SUCCEEDED,
        OperationStatus.TIMED_OUT,
      ];

      const nonCompletedStatuses = [
        OperationStatus.STARTED,
        OperationStatus.READY,
        OperationStatus.PENDING,
      ];

      completedStatuses.forEach((status) => {
        expect(doesStatusMatch(status, WaitingOperationStatus.COMPLETED)).toBe(
          true
        );
      });

      nonCompletedStatuses.forEach((status) => {
        expect(doesStatusMatch(status, WaitingOperationStatus.COMPLETED)).toBe(
          false
        );
      });
    });
  });
});
