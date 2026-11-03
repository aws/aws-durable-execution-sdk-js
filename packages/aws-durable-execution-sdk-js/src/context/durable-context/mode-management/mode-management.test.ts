import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";
import { ModeManagement } from "./mode-management";
import { DurablePromise } from "../../../types";
import { DurableExecutionMode } from "../../../types/core";

describe("ModeManagement", () => {
  let modeManagement: ModeManagement;
  let mockCaptureExecutionState: Mock;
  let mockCheckAndUpdateReplayMode: Mock;
  let mockCheckForNonResolvingPromise: Mock;
  let mockGetDurableExecutionMode: Mock;
  let mockSetDurableExecutionMode: Mock;

  beforeEach(() => {
    mockCaptureExecutionState = vi.fn();
    mockCheckAndUpdateReplayMode = vi.fn();
    mockCheckForNonResolvingPromise = vi.fn();
    mockGetDurableExecutionMode = vi.fn();
    mockSetDurableExecutionMode = vi.fn();

    modeManagement = new ModeManagement(
      mockCaptureExecutionState,
      mockCheckAndUpdateReplayMode,
      mockCheckForNonResolvingPromise,
      mockGetDurableExecutionMode,
      mockSetDurableExecutionMode,
    );
  });

  describe("withModeManagement", () => {
    it("should execute operation and switch mode when needed", async () => {
      mockCaptureExecutionState.mockReturnValue(true);
      mockCheckForNonResolvingPromise.mockReturnValue(null);

      const operation = vi.fn().mockResolvedValue("result");

      const result = await modeManagement.withModeManagement(operation);

      expect(mockCaptureExecutionState).toHaveBeenCalled();
      expect(mockCheckAndUpdateReplayMode).toHaveBeenCalled();
      expect(mockCheckForNonResolvingPromise).toHaveBeenCalled();
      expect(operation).toHaveBeenCalled();
      expect(mockSetDurableExecutionMode).toHaveBeenCalledWith(
        DurableExecutionMode.ExecutionMode,
      );
      expect(result).toBe("result");
    });

    it("should return non-resolving promise when available", () => {
      const nonResolvingPromise = new Promise<never>(() => {}); // Never resolves
      mockCheckForNonResolvingPromise.mockReturnValue(nonResolvingPromise);

      const operation = vi.fn();

      const result = modeManagement.withModeManagement(operation);

      expect(result).toBe(nonResolvingPromise);
      expect(operation).not.toHaveBeenCalled();
      expect(mockSetDurableExecutionMode).not.toHaveBeenCalled();
    });

    it("should not switch mode when captureExecutionState returns false", async () => {
      mockCaptureExecutionState.mockReturnValue(false);
      mockCheckForNonResolvingPromise.mockReturnValue(null);

      const operation = vi.fn().mockResolvedValue("result");

      await modeManagement.withModeManagement(operation);

      expect(mockSetDurableExecutionMode).not.toHaveBeenCalled();
    });

    it("should switch mode even if operation throws", async () => {
      mockCaptureExecutionState.mockReturnValue(true);
      mockCheckForNonResolvingPromise.mockReturnValue(null);

      const operation = vi
        .fn()
        .mockRejectedValue(new Error("Operation failed"));

      await expect(
        modeManagement.withModeManagement(operation),
      ).rejects.toThrow("Operation failed");

      expect(mockSetDurableExecutionMode).toHaveBeenCalledWith(
        DurableExecutionMode.ExecutionMode,
      );
    });
  });

  describe("withDurableModeManagement", () => {
    it("should execute operation and switch mode when needed", () => {
      mockCaptureExecutionState.mockReturnValue(true);
      mockCheckForNonResolvingPromise.mockReturnValue(null);

      const durablePromise = new DurablePromise(async () => "result");
      const operation = vi.fn().mockReturnValue(durablePromise);

      const result = modeManagement.withDurableModeManagement(operation);

      expect(mockCaptureExecutionState).toHaveBeenCalled();
      expect(mockCheckAndUpdateReplayMode).toHaveBeenCalled();
      expect(mockCheckForNonResolvingPromise).toHaveBeenCalled();
      expect(operation).toHaveBeenCalled();
      expect(mockSetDurableExecutionMode).toHaveBeenCalledWith(
        DurableExecutionMode.ExecutionMode,
      );
      expect(result).toBe(durablePromise);
    });

    it("should return DurablePromise with non-resolving promise when available", () => {
      const nonResolvingPromise = new Promise<never>(() => {}); // Never resolves
      mockCheckForNonResolvingPromise.mockReturnValue(nonResolvingPromise);

      const operation = vi.fn();

      const result = modeManagement.withDurableModeManagement(operation);

      expect(result).toBeInstanceOf(DurablePromise);
      expect(operation).not.toHaveBeenCalled();
      expect(mockSetDurableExecutionMode).not.toHaveBeenCalled();
    });

    it("should not switch mode when captureExecutionState returns false", () => {
      mockCaptureExecutionState.mockReturnValue(false);
      mockCheckForNonResolvingPromise.mockReturnValue(null);

      const durablePromise = new DurablePromise(async () => "result");
      const operation = vi.fn().mockReturnValue(durablePromise);

      modeManagement.withDurableModeManagement(operation);

      expect(mockSetDurableExecutionMode).not.toHaveBeenCalled();
    });

    it("should switch mode even if operation throws", () => {
      mockCaptureExecutionState.mockReturnValue(true);
      mockCheckForNonResolvingPromise.mockReturnValue(null);

      const operation = vi.fn().mockImplementation(() => {
        throw new Error("Operation failed");
      });

      expect(() => modeManagement.withDurableModeManagement(operation)).toThrow(
        "Operation failed",
      );

      expect(mockSetDurableExecutionMode).toHaveBeenCalledWith(
        DurableExecutionMode.ExecutionMode,
      );
    });
  });
});
