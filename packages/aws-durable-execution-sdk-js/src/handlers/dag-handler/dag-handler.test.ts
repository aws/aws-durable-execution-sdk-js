import { createDagHandler } from "./dag-handler";
import { ExecutionContext, DurableContext, DurableLogger } from "../../types";

describe("DAG Handler config guards", () => {
  let mockExecutionContext: jest.Mocked<ExecutionContext>;
  let mockRunInChildContext: jest.MockedFunction<
    DurableContext<DurableLogger>["runInChildContext"]
  >;
  let dagHandler: ReturnType<typeof createDagHandler>;

  beforeEach(() => {
    mockExecutionContext = {} as jest.Mocked<ExecutionContext>;
    mockRunInChildContext = jest.fn();
    dagHandler = createDagHandler(mockRunInChildContext, mockExecutionContext);
  });

  it("should terminate execution for invalid maxConcurrency", async () => {
    const terminate = jest.fn();
    (mockExecutionContext as any).terminationManager = { terminate };

    // DurablePromise defers its executor until awaited/chained; chain .catch
    // to trigger it without unhandled-rejection noise. The chained promise
    // never resolves (execution is terminated), so we don't await it -- just
    // assert the termination was requested.
    void dagHandler("bad-concurrency", jest.fn(), {
      maxConcurrency: 0,
    }).catch(() => {});
    await Promise.resolve();

    expect(terminate).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "CONFIG_VALIDATION_ERROR",
        message: expect.stringContaining("Invalid maxConcurrency: 0"),
      }),
    );

    terminate.mockClear();
    void dagHandler("bad-concurrency", jest.fn(), {
      maxConcurrency: -1,
    }).catch(() => {});
    await Promise.resolve();

    expect(terminate).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "CONFIG_VALIDATION_ERROR",
        message: expect.stringContaining("Invalid maxConcurrency: -1"),
      }),
    );
  });

  it("should terminate execution when completionConfig combines shouldComplete with threshold fields", async () => {
    const terminate = jest.fn();
    (mockExecutionContext as any).terminationManager = { terminate };

    // Cast bypasses the compile-time union to exercise the runtime guard.
    void dagHandler("bad-completion", jest.fn(), {
      completionConfig: {
        minSuccessful: 1,
        shouldComplete: () => ({ complete: false }) as any,
      } as any,
    }).catch(() => {});
    await Promise.resolve();

    expect(terminate).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "CONFIG_VALIDATION_ERROR",
        message: expect.stringMatching(/mutually exclusive/),
      }),
    );
  });

  it("should not terminate execution for a valid maxConcurrency", async () => {
    const terminate = jest.fn();
    (mockExecutionContext as any).terminationManager = { terminate };
    mockRunInChildContext.mockReturnValue(
      new Promise(() => {}) as unknown as ReturnType<
        DurableContext<DurableLogger>["runInChildContext"]
      >,
    );

    void dagHandler("ok-concurrency", jest.fn(), {
      maxConcurrency: 5,
    }).catch(() => {});
    await Promise.resolve();

    expect(terminate).not.toHaveBeenCalled();
  });
});
