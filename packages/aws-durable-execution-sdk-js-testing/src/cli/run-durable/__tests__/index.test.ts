import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
describe("CLI Entry Point (index.ts)", () => {
  const originalConsoleError = console.error;
  const mockConsoleError = vi.fn();

  const mockExit = vi.spyOn(process, "exit");

  beforeEach(() => {
    console.error = mockConsoleError;
    mockExit.mockImplementation((() => {
      // Mock implementation to prevent actual process exit
    }) as never);
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("should successfully call runDurable when no errors occur", async () => {
    vi.resetModules();
    const mockRunDurable = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../run-durable", async () => ({
      ...(await vi.importActual<typeof import("../run-durable")>(
        "../run-durable",
      )),
      runDurable: mockRunDurable,
    }));

    await import("../index");

    expect(mockRunDurable).toHaveBeenCalledTimes(1);
    expect(mockConsoleError).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should handle errors from runDurable and exit with code 1", async () => {
    vi.resetModules();
    const testError = new Error("Test CLI error");
    const mockRunDurable = vi.fn().mockRejectedValue(testError);
    vi.doMock("../run-durable", async () => ({
      ...(await vi.importActual<typeof import("../run-durable")>(
        "../run-durable",
      )),
      runDurable: mockRunDurable,
    }));

    await import("../index");

    expect(mockRunDurable).toHaveBeenCalledTimes(1);
    expect(mockConsoleError).toHaveBeenCalledWith(testError);
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
