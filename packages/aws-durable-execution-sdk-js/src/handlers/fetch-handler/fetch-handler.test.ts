import { createFetchHandler } from "./fetch-handler";
import { ExecutionContext, OperationSubType } from "../../types";
import {
  FetchBodyEncoding,
  Operation,
  OperationAction,
  OperationStatus,
  OperationType,
} from "../../types/wire";
import { Checkpoint } from "../../utils/checkpoint/checkpoint-helper";
import { FetchError } from "../../errors/durable-error/durable-error";
import { DurableInstrumentationPlugin } from "../../types/plugin";

jest.mock("../../utils/logger/logger");

describe("FetchHandler", () => {
  let mockContext: ExecutionContext;
  let mockCheckpoint: Checkpoint;
  let mockCreateStepId: jest.Mock;
  let checkAndUpdateReplayMode: jest.Mock;

  /** A completed exchange as the service would record it. */
  const succeeded = (overrides: Partial<Operation> = {}): Operation =>
    ({
      Status: OperationStatus.SUCCEEDED,
      Type: OperationType.FETCH,
      FetchDetails: {
        StatusCode: 200,
        Headers: { "content-type": "text/plain" },
        Result: "body text",
      },
      ...overrides,
    }) as Operation;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCreateStepId = jest.fn().mockReturnValue("test-step-1");
    checkAndUpdateReplayMode = jest.fn();

    mockCheckpoint = {
      checkpoint: jest.fn().mockResolvedValue(undefined),
      markOperationState: jest.fn(),
      markOperationAwaited: jest.fn(),
      waitForStatusChange: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockContext = {
      getStepData: jest.fn().mockReturnValue(undefined),
      terminationManager: { terminate: jest.fn() },
      durableExecutionArn: "test-arn",
      isOperationUpdatedBetweenInvocation: jest.fn().mockReturnValue(false),
    } as any;
  });

  const createHandler = (plugin?: DurableInstrumentationPlugin) =>
    createFetchHandler(
      mockContext,
      mockCheckpoint,
      mockCreateStepId,
      undefined,
      checkAndUpdateReplayMode,
      plugin,
    );

  describe("starting the operation", () => {
    it("checkpoints a START carrying the url and options, and the body as the payload", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(succeeded());

      await createHandler()("https://example.com/thing", {
        method: "POST",
        headers: { authorization: "Bearer t" },
        body: "request body",
        timeout: { minutes: 1 },
      });

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith("test-step-1", {
        Id: "test-step-1",
        ParentId: undefined,
        Action: OperationAction.START,
        Type: OperationType.FETCH,
        SubType: OperationSubType.FETCH,
        Name: undefined,
        Payload: "request body",
        FetchOptions: {
          Url: "https://example.com/thing",
          Method: "POST",
          Headers: { authorization: "Bearer t" },
          TimeoutSeconds: 60,
        },
      });
    });

    it("omits absent options rather than sending them as undefined", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(succeeded());

      await createHandler()("https://example.com/thing");

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith(
        "test-step-1",
        expect.objectContaining({
          Payload: undefined,
          FetchOptions: { Url: "https://example.com/thing" },
        }),
      );
    });

    it("never asks the service to SUCCEED or FAIL the operation", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(succeeded());

      await createHandler()("https://example.com/thing");

      // The service owns the outcome. An SDK-side completion would let a workflow record a
      // response it never received.
      const actions = (mockCheckpoint.checkpoint as jest.Mock).mock.calls.map(
        ([, update]) => update.Action,
      );
      expect(actions).toEqual([OperationAction.START]);
    });

    it("accepts a leading name and records it on the operation", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(succeeded());

      await createHandler()("charge", "https://example.com/charges", {
        method: "POST",
      });

      expect(mockCheckpoint.checkpoint).toHaveBeenCalledWith(
        "test-step-1",
        expect.objectContaining({
          Name: "charge",
          FetchOptions: expect.objectContaining({
            Url: "https://example.com/charges",
            Method: "POST",
          }),
        }),
      );
    });
  });

  describe("resolving a recorded response", () => {
    it("returns the status, headers and body the service recorded", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(succeeded());

      const response = await createHandler()("https://example.com/thing");

      expect(response).toEqual({
        status: 200,
        ok: true,
        headers: { "content-type": "text/plain" },
        body: "body text",
      });
    });

    it.each([
      [200, true],
      [201, true],
      [299, true],
      [300, false],
      [404, false],
      [500, false],
    ])("resolves a %i response with ok=%s", async (statusCode, ok) => {
      // Nothing counts as a failure: whatever the endpoint answered is handed back for the
      // workflow to interpret.
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(
          succeeded({ FetchDetails: { StatusCode: statusCode } }),
        );

      const response = await createHandler()("https://example.com/thing");

      expect(response.status).toBe(statusCode);
      expect(response.ok).toBe(ok);
    });

    it("defaults a missing body and headers rather than returning undefined", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(succeeded({ FetchDetails: { StatusCode: 204 } }));

      const response = await createHandler()("https://example.com/thing");

      expect(response.body).toBe("");
      expect(response.headers).toEqual({});
    });

    it("returns the recorded response without re-checkpointing on replay", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValue(succeeded());

      const response = await createHandler()("https://example.com/thing");

      expect(response.status).toBe(200);
      expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
      expect(mockCheckpoint.waitForStatusChange).not.toHaveBeenCalled();
      expect(checkAndUpdateReplayMode).toHaveBeenCalled();
    });

    it("rejects when the service reports success without a status code", async () => {
      // A contract violation rather than a workflow-level failure, so it should be loud
      // instead of surfacing as `status: undefined`.
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(succeeded({ FetchDetails: { Result: "body" } }));

      await expect(
        createHandler()("https://example.com/thing"),
      ).rejects.toThrow(/without recording a response status code/);
    });
  });

  describe("body encoding", () => {
    it("treats an absent encoding as UTF8", async () => {
      // The compatibility rule the field rests on: a record with no encoding is text, which
      // is what lets BASE64 be added later without changing how existing records read.
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(
          succeeded({
            FetchDetails: { StatusCode: 200, Result: "plain text" },
          }),
        );

      const response = await createHandler()("https://example.com/thing");

      expect(response.body).toBe("plain text");
    });

    it("accepts an explicit UTF8 encoding", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(
          succeeded({
            FetchDetails: {
              StatusCode: 200,
              Result: "plain text",
              BodyEncoding: FetchBodyEncoding.UTF8,
            },
          }),
        );

      const response = await createHandler()("https://example.com/thing");

      expect(response.body).toBe("plain text");
    });

    it("refuses a BASE64 body rather than handing back corrupted text", async () => {
      // Models a service newer than the SDK. Decoding into `body` would silently produce
      // mojibake for real binary, and the workflow would have no way to tell.
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(
          succeeded({
            FetchDetails: {
              StatusCode: 200,
              Result: "AAECAw==",
              BodyEncoding: FetchBodyEncoding.BASE64,
            },
          }),
        );

      const promise = createHandler()("https://example.com/thing");

      await expect(promise).rejects.toThrow(FetchError);
      // Names the encoding, so the failure says what happened rather than just "bad body".
      await expect(promise).rejects.toThrow(/BASE64-encoded response body/);
      await expect(promise).rejects.toThrow(/Only UTF8 bodies are supported/);
    });

    it("does not send a BodyEncoding, since only UTF8 is produced", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(succeeded());

      await createHandler()("https://example.com/thing", { body: "hello" });

      const [, update] = (mockCheckpoint.checkpoint as jest.Mock).mock.calls[0];
      expect(update.FetchOptions).not.toHaveProperty("BodyEncoding");
    });
  });

  describe("failing outcomes", () => {
    it.each([
      OperationStatus.FAILED,
      OperationStatus.TIMED_OUT,
      OperationStatus.STOPPED,
    ])("rejects with a FetchError when the operation is %s", async (status) => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: status,
          Type: OperationType.FETCH,
          FetchDetails: {
            Error: {
              ErrorMessage: "connection reset",
              ErrorType: "FetchError",
            },
          },
        });

      await expect(
        createHandler()("https://example.com/thing"),
      ).rejects.toThrow(FetchError);
      await expect(
        createHandler()("https://example.com/thing"),
      ).rejects.toThrow("connection reset");
    });

    it("rejects with the status when no error was recorded", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.FAILED,
          Type: OperationType.FETCH,
        });

      await expect(
        createHandler()("https://example.com/thing"),
      ).rejects.toThrow("Fetch failed with status FAILED");
    });

    it("carries the recorded error data onto the thrown error", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.FAILED,
          Type: OperationType.FETCH,
          FetchDetails: {
            Error: { ErrorMessage: "timed out", ErrorData: '{"after":30}' },
          },
        });

      await expect(
        createHandler()("https://example.com/thing"),
      ).rejects.toMatchObject({
        errorType: "FetchError",
        errorData: '{"after":30}',
      });
    });

    it("rejects on replay of an already failed operation without re-checkpointing", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValue({
        Status: OperationStatus.FAILED,
        Type: OperationType.FETCH,
        FetchDetails: { Error: { ErrorMessage: "connection reset" } },
      });

      await expect(
        createHandler()("https://example.com/thing"),
      ).rejects.toThrow("connection reset");
      expect(mockCheckpoint.checkpoint).not.toHaveBeenCalled();
    });
  });

  describe("suspension", () => {
    it("marks the operation awaited and waits for the service to record an outcome", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(succeeded());

      await createHandler()("https://example.com/thing");

      expect(mockCheckpoint.markOperationAwaited).toHaveBeenCalledWith(
        "test-step-1",
      );
      expect(mockCheckpoint.waitForStatusChange).toHaveBeenCalledWith(
        "test-step-1",
      );
    });
  });

  describe("instrumentation", () => {
    it("reports a first run as not a replay", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue(succeeded());

      const plugin = {
        onOperationStart: jest.fn(),
        onOperationEnd: jest.fn(),
      };

      await createHandler(plugin)("call", "https://example.com/thing");

      expect(plugin.onOperationStart).toHaveBeenCalledWith(
        expect.objectContaining({
          type: OperationType.FETCH,
          subType: OperationSubType.FETCH,
          isReplay: false,
        }),
      );
      expect(plugin.onOperationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ isReplay: false }),
      );
    });

    it("reports an operation that completed in an earlier invocation as a replay", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValue(succeeded());
      (
        mockContext.isOperationUpdatedBetweenInvocation as jest.Mock
      ).mockReturnValue(false);

      const plugin = { onOperationEnd: jest.fn() };

      await createHandler(plugin)("https://example.com/thing");

      expect(plugin.onOperationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ isReplay: true }),
      );
    });

    it("reports an operation the service completed since the last invocation as not a replay", async () => {
      (mockContext.getStepData as jest.Mock).mockReturnValue(succeeded());
      (
        mockContext.isOperationUpdatedBetweenInvocation as jest.Mock
      ).mockReturnValue(true);

      const plugin = { onOperationEnd: jest.fn() };

      await createHandler(plugin)("https://example.com/thing");

      expect(plugin.onOperationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ isReplay: false }),
      );
    });

    it("attaches the error when the operation failed", async () => {
      (mockContext.getStepData as jest.Mock)
        .mockReturnValueOnce(undefined)
        .mockReturnValue({
          Status: OperationStatus.FAILED,
          Type: OperationType.FETCH,
          FetchDetails: { Error: { ErrorMessage: "connection reset" } },
        });

      const plugin = { onOperationEnd: jest.fn() };

      await expect(
        createHandler(plugin)("https://example.com/thing"),
      ).rejects.toThrow("connection reset");

      expect(plugin.onOperationEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ message: "connection reset" }),
        }),
      );
    });
  });
});
