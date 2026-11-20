import { describe, it, expect } from "vitest";
import {
  buildSummary,
  toDistributedMapDestinationOptions,
} from "./distributed-map-handler";
import {
  DistributedMapDestination,
  DistributedMapItemStatus,
  DistributedMapResult,
  DistributedMapStatus,
} from "../../types";
import { DistributedMapDetails } from "../../types/wire";
import {
  AnySerdes,
  defaultSerdes,
  SerdesContext,
} from "../../utils/serdes/serdes";
import {
  DistributedMapError,
  DistributedMapItemError,
} from "../../errors/durable-error/durable-error";
import { dmapSerdesContext } from "./distributed-map-serdes-context";

const RUN_ARN =
  "arn:aws:lambda:us-east-1:123456789012:function:parent:$LATEST/durable-execution/e/i/distributed-map-run/run-1";

// The counts the service sends at every terminal state. TotalCount is required for SUCCEEDED.
const COUNTS = {
  SuccessCount: 0,
  FailureCount: 0,
  ReadCount: 0,
  TotalCount: 0,
};

// Minimal context: the success decode path never touches the termination manager.
const fakeContext = {
  terminationManager: {} as any,
  durableExecutionArn: "arn:test",
} as any;

function detailsWith(
  results: NonNullable<DistributedMapDetails["Results"]>,
): DistributedMapDetails {
  return {
    ...COUNTS,
    DistributedMapRunArn: RUN_ARN,
    SourceExhausted: true,
    SuccessCount: results.length,
    Results: results,
  };
}

describe("Distributed map handler second-pass fixes", () => {
  it("runs a custom item serdes on the decode path when collecting results", async () => {
    // Custom serdes only defines decode: doubles the JSON number it reads back.
    const doublingSerdes: AnySerdes = {
      serialize: async (v) => JSON.stringify(v),
      deserialize: async (data) => (JSON.parse(data as string) as number) * 2,
    };
    const details = detailsWith([
      { ItemId: "0", Status: "SUCCEEDED", Output: "21" },
    ]);

    const result = (await buildSummary(
      details,
      { collectResults: true, resultSerdes: doublingSerdes },
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "SUCCEEDED",
    )) as DistributedMapResult<number>;

    expect(result.getResults()).toEqual([42]);
  });

  it("round-trips falsy per-item outputs without dropping them", async () => {
    const details = detailsWith([
      { ItemId: "0", Status: "SUCCEEDED", Output: "0" },
      { ItemId: "1", Status: "SUCCEEDED", Output: "false" },
      { ItemId: "2", Status: "SUCCEEDED", Output: '""' },
      { ItemId: "3", Status: "SUCCEEDED", Output: "[]" },
      { ItemId: "4", Status: "SUCCEEDED", Output: "{}" },
    ]);

    const result = (await buildSummary(
      details,
      { collectResults: true },
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "SUCCEEDED",
    )) as DistributedMapResult<unknown>;

    expect(result.getResults()).toEqual([0, false, "", [], {}]);
    expect(result.getResults()).toHaveLength(5);
  });

  it("reads each collected output with the ('output', itemId) context the processor wrote it with", async () => {
    const contexts: SerdesContext[] = [];
    const recordingSerdes: AnySerdes = {
      serialize: async (v) => JSON.stringify(v),
      deserialize: async (data, context) => {
        contexts.push(context);
        return JSON.parse(data as string);
      },
    };

    await buildSummary(
      detailsWith([
        { ItemId: "item-a", Status: "SUCCEEDED", Output: "1" },
        { ItemId: "item-b", Status: "SUCCEEDED", Output: "2" },
      ]),
      { collectResults: true, resultSerdes: recordingSerdes },
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "SUCCEEDED",
    );

    expect(contexts).toEqual([
      dmapSerdesContext(RUN_ARN, "output", "item-a"),
      dmapSerdesContext(RUN_ARN, "output", "item-b"),
    ]);
  });

  it.each([
    ["a missing", undefined],
    ["a malformed", "arn:not-a-run"],
  ])(
    "throws DistributedMapError for a collected output with %s run ARN",
    async (_label, arn) => {
      const details = {
        ...detailsWith([
          { ItemId: "item-a", Status: "SUCCEEDED", Output: "1" },
        ]),
        DistributedMapRunArn: arn,
      };

      await expect(
        buildSummary(
          details,
          { collectResults: true },
          "step-0",
          undefined,
          fakeContext,
          defaultSerdes,
          "SUCCEEDED",
        ),
      ).rejects.toThrow(
        new DistributedMapError(
          "missing or invalid distributed map run ARN from backend",
        ),
      );
    },
  );
});

describe("Distributed map handler enum parsing", () => {
  const cfg = {};

  it("resolves a completed run that carries only counts", async () => {
    const summary = await buildSummary(
      { ...COUNTS, FailureCount: 0 },
      cfg,
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "SUCCEEDED",
    );

    expect(summary.status).toBe("SUCCEEDED");
    expect(summary.sourceExhausted).toBeUndefined();
    expect(summary.error).toBeUndefined();
  });

  it("throws when a created run carries no SourceExhausted", async () => {
    await expect(
      buildSummary(
        { ...COUNTS, DistributedMapRunArn: "arn:run", FailureCount: 0 },
        cfg,
        "step-0",
        undefined,
        fakeContext,
        defaultSerdes,
        "SUCCEEDED",
      ),
    ).rejects.toThrow("missing distributed map SourceExhausted from backend");
  });

  it("accepts a created run that carries SourceExhausted", async () => {
    const summary = await buildSummary(
      {
        ...COUNTS,
        DistributedMapRunArn: "arn:run",
        SourceExhausted: true,
        FailureCount: 0,
      },
      cfg,
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "SUCCEEDED",
    );
    expect(summary.distributedMapRunArn).toBe("arn:run");
    expect(summary.sourceExhausted).toBe(true);
  });

  it("passes SourceExhausted and the run Error through", async () => {
    const error = {
      ErrorType: "SourceReadError",
      ErrorMessage: "object not found",
    };
    const summary = await buildSummary(
      { ...COUNTS, SourceExhausted: false, Error: error, FailureCount: 0 },
      cfg,
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "FAILED",
    );

    expect(summary.sourceExhausted).toBe(false);
    expect(summary.error).toEqual(error);
  });

  it("derives the run status from the operation status", async () => {
    const summary = await buildSummary(
      { ...COUNTS, FailureCount: 0 },
      cfg,
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "SUCCEEDED",
    );

    expect(summary.status).toBe("SUCCEEDED");
  });

  it("reports a non-succeeded operation status as the run status", async () => {
    const summary = await buildSummary(
      { ...COUNTS, FailureCount: 1 },
      cfg,
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "FAILED",
    );

    expect(summary.status).toBe("FAILED");
  });

  it("maps an unknown run Status to the UNKNOWN_TO_SDK_VERSION sentinel", async () => {
    const summary = await buildSummary(
      { ...COUNTS },
      cfg,
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "NONSENSE",
    );
    expect(summary.status).toBe(DistributedMapStatus.UNKNOWN_TO_SDK_VERSION);
    expect(() => summary.throwIfError()).toThrow(DistributedMapError);
  });

  it("throws on a missing run Status", async () => {
    await expect(
      buildSummary(
        { ...COUNTS },
        cfg,
        "step-0",
        undefined,
        fakeContext,
        defaultSerdes,
        undefined,
      ),
    ).rejects.toThrow(DistributedMapError);
  });

  it("maps an unknown per-item Status to the UNKNOWN_TO_SDK_VERSION sentinel", async () => {
    const result = (await buildSummary(
      {
        ...COUNTS,
        FailureCount: 0,
        Results: [{ ItemId: "0", Status: "BOGUS" }],
      },
      { collectResults: true },
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "SUCCEEDED",
    )) as DistributedMapResult<unknown>;
    expect(result.all[0].status).toBe(
      DistributedMapItemStatus.UNKNOWN_TO_SDK_VERSION,
    );
    expect(result.succeeded()).toHaveLength(0);
    expect(result.failed()).toHaveLength(0);
  });

  it("throws on a missing per-item Status when collecting results", async () => {
    await expect(
      buildSummary(
        { ...COUNTS, FailureCount: 0, Results: [{ ItemId: "0" }] },
        { collectResults: true },
        "step-0",
        undefined,
        fakeContext,
        defaultSerdes,
        "SUCCEEDED",
      ),
    ).rejects.toThrow(DistributedMapError);
  });

  it("throws on a missing per-item ItemId when collecting results", async () => {
    await expect(
      buildSummary(
        {
          ...COUNTS,
          FailureCount: 0,
          Results: [{ Status: "SUCCEEDED", Output: "1" }],
        },
        { collectResults: true },
        "step-0",
        undefined,
        fakeContext,
        defaultSerdes,
        "SUCCEEDED",
      ),
    ).rejects.toThrow("missing distributed map item id from backend");
  });
});

describe("Distributed map handler required counts", () => {
  it.each(["SuccessCount", "FailureCount", "ReadCount"])(
    "throws when a terminal operation carries no %s",
    async (field) => {
      const details: Record<string, unknown> = { ...COUNTS };
      delete details[field];
      await expect(
        buildSummary(
          details as DistributedMapDetails,
          {},
          "step-0",
          undefined,
          fakeContext,
          defaultSerdes,
          "FAILED",
        ),
      ).rejects.toThrow(`missing distributed map ${field} from backend`);
    },
  );

  it("throws when a SUCCEEDED operation carries no TotalCount", async () => {
    const { TotalCount: _omitted, ...details } = COUNTS;
    await expect(
      buildSummary(
        details,
        {},
        "step-0",
        undefined,
        fakeContext,
        defaultSerdes,
        "SUCCEEDED",
      ),
    ).rejects.toThrow("missing distributed map TotalCount from backend");
  });

  it("accepts a missing TotalCount on a run that did not succeed", async () => {
    const { TotalCount: _omitted, ...details } = COUNTS;
    const summary = await buildSummary(
      details,
      {},
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "STOPPED",
    );
    expect(summary.totalCount).toBeUndefined();
  });

  it.each([false, true])(
    "returns the service ReadCount as readCount (collectResults %s)",
    async (collectResults) => {
      const summary = await buildSummary(
        { ...detailsWith([]), ReadCount: 7 },
        { collectResults },
        "step-0",
        undefined,
        fakeContext,
        defaultSerdes,
        "SUCCEEDED",
      );
      expect(summary.readCount).toBe(7);
    },
  );
});

describe("Distributed map handler collected result access", () => {
  it("builds a failed item's error as a DistributedMapItemError", async () => {
    const result = (await buildSummary(
      {
        ...COUNTS,
        SuccessCount: 0,
        FailureCount: 1,
        Results: [
          {
            ItemId: "0",
            Status: "FAILED",
            Error: {
              ErrorType: "BoomError",
              ErrorMessage: "kaboom",
              ErrorData: "data",
            },
          },
        ],
      },
      { collectResults: true },
      "step-0",
      undefined,
      fakeContext,
      defaultSerdes,
      "SUCCEEDED",
    )) as DistributedMapResult<unknown>;

    const [error] = result.getErrors();
    expect(error).toBeInstanceOf(DistributedMapItemError);
    expect(error).toBeInstanceOf(DistributedMapError);
    expect(error?.errorType).toBe("DistributedMapItemError");
    expect(error?.message).toBe("kaboom");
    expect(error?.errorData).toBe("data");
    expect(error?.cause?.name).toBe("BoomError");
    expect(error?.cause?.message).toBe("kaboom");
  });
});

describe("Distributed map destination to wire mapping", () => {
  it("sends the destinations the factories built", () => {
    const wire = toDistributedMapDestinationOptions({
      destination: {
        onSuccess: DistributedMapDestination.s3.successes("s3://b/out/"),
        onFailure: DistributedMapDestination.s3.failures("s3://b/err/"),
      },
    });
    expect(wire?.OnSuccess?.Include).toEqual(["OUTPUT"]);
    expect(wire?.OnSuccess?.S3DestinationConfig?.KeyPrefix).toBe("out/");
    expect(wire?.OnFailure?.Include).toEqual(["INPUT", "ERROR"]);
  });

  it("sends no destination when neither is set", () => {
    expect(toDistributedMapDestinationOptions({})).toBeUndefined();
    expect(
      toDistributedMapDestinationOptions({ destination: {} }),
    ).toBeUndefined();
  });
});
