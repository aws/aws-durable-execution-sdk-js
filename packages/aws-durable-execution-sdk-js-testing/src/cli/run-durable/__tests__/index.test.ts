describe("CLI Entry Point (index.ts)", () => {
  const originalConsoleError = console.error;
  const mockConsoleError = jest.fn();

  const mockExit = jest.spyOn(process, "exit");

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
    await jest.isolateModulesAsync(async () => {
      const runDurableModule = await import("../run-durable");
      const mockRunDurable = jest
        .spyOn(runDurableModule, "runDurable")
        .mockResolvedValue();

      await import("../index");

      expect(mockRunDurable).toHaveBeenCalledTimes(1);
      expect(mockConsoleError).not.toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  it("should handle errors from runDurable and exit with code 1", async () => {
    await jest.isolateModulesAsync(async () => {
      const testError = new Error("Test CLI error");
      const runDurableModule = await import("../run-durable");
      const mockRunDurable = jest
        .spyOn(runDurableModule, "runDurable")
        .mockRejectedValue(testError);

      await import("../index");

      expect(mockRunDurable).toHaveBeenCalledTimes(1);
      expect(mockConsoleError).toHaveBeenCalledWith(testError);
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
