import { describe, it, expect } from "vitest";
import {
  assertCompletionConfig,
  assertDestination,
  assertProcessor,
  assertSource,
  DistributedMapCompletionConfig,
  DistributedMapDestination,
  DistributedMapDestinationConfig,
  DistributedMapProcessor,
  DistributedMapProcessorRetryConfig,
  DistributedMapSource,
  DistributedMapS3SourceConfig,
  FailureDestination,
  SuccessDestination,
} from "./distributed-map";

const s3Wire = (source: DistributedMapSource<unknown>): unknown =>
  source.definition.type === "S3" ? source.definition.s3 : undefined;

describe("Distributed map S3 source factories", () => {
  it("maps each object factory to an OBJECT source with a key and a format", () => {
    expect(s3Wire(DistributedMapSource.s3.jsonLines("s3://b/k.jsonl"))).toEqual(
      {
        Type: "OBJECT",
        Bucket: "b",
        ObjectConfig: { Key: "k.jsonl", Format: "JSON_LINES" },
      },
    );
    expect(s3Wire(DistributedMapSource.s3.jsonArray("s3://b/k.json"))).toEqual({
      Type: "OBJECT",
      Bucket: "b",
      ObjectConfig: { Key: "k.json", Format: "JSON_ARRAY" },
    });
    expect(s3Wire(DistributedMapSource.s3.csv("s3://b/k.csv"))).toEqual({
      Type: "OBJECT",
      Bucket: "b",
      ObjectConfig: {
        Key: "k.csv",
        Format: "CSV",
        CsvFormatOptions: { HeaderLocation: "FIRST_ROW", Delimiter: "COMMA" },
      },
    });
  });

  it("maps objects to a LISTED_OBJECT_METADATA source", () => {
    expect(s3Wire(DistributedMapSource.s3.objects("s3://b/p/"))).toEqual({
      Type: "LISTED_OBJECT_METADATA",
      Bucket: "b",
      ListedObjectMetadataConfig: { KeyPrefix: "p/" },
    });
  });

  it("maps each flattened factory to a LISTED_OBJECTS source with a format", () => {
    expect(
      s3Wire(DistributedMapSource.s3.flattenedJsonLines("s3://b/p/")),
    ).toEqual({
      Type: "LISTED_OBJECTS",
      Bucket: "b",
      ListedObjectsConfig: { KeyPrefix: "p/", Format: "JSON_LINES" },
    });
    expect(
      s3Wire(DistributedMapSource.s3.flattenedJsonArray("s3://b/p/")),
    ).toEqual({
      Type: "LISTED_OBJECTS",
      Bucket: "b",
      ListedObjectsConfig: { KeyPrefix: "p/", Format: "JSON_ARRAY" },
    });
    expect(
      s3Wire(
        DistributedMapSource.s3.flattenedCsv("s3://b/p/", { delimiter: "TAB" }),
      ),
    ).toEqual({
      Type: "LISTED_OBJECTS",
      Bucket: "b",
      ListedObjectsConfig: {
        KeyPrefix: "p/",
        Format: "CSV",
        CsvFormatOptions: { HeaderLocation: "FIRST_ROW", Delimiter: "TAB" },
      },
    });
  });

  it("accepts an empty prefix, which lists the whole bucket", () => {
    expect(s3Wire(DistributedMapSource.s3.objects("s3://b"))).toEqual({
      Type: "LISTED_OBJECT_METADATA",
      Bucket: "b",
      ListedObjectMetadataConfig: { KeyPrefix: "" },
    });
    expect(
      s3Wire(DistributedMapSource.s3.flattenedJsonLines("s3://b")),
    ).toEqual({
      Type: "LISTED_OBJECTS",
      Bucket: "b",
      ListedObjectsConfig: { KeyPrefix: "", Format: "JSON_LINES" },
    });
  });

  it("rejects an object source with no key", () => {
    expect(() => DistributedMapSource.s3.jsonLines("s3://b")).toThrow(
      /requires a key/,
    );
    expect(() => DistributedMapSource.s3.csv("s3://b/")).toThrow(
      /requires a key/,
    );
  });

  it("rejects a URI with the wrong scheme or no bucket", () => {
    expect(() => DistributedMapSource.s3.jsonLines("https://b/k")).toThrow(
      /must start with s3:\/\//,
    );
    expect(() => DistributedMapSource.s3.objects("s3:///p/")).toThrow(
      /missing bucket/,
    );
  });

  it("sends the expected bucket owner and max items", () => {
    const source = DistributedMapSource.s3.jsonLines("s3://b/k", {
      expectedBucketOwner: "123456789012",
      maxItems: 5,
    });
    expect(source.definition).toEqual({
      type: "S3",
      maxItems: 5,
      s3: {
        Type: "OBJECT",
        Bucket: "b",
        ExpectedBucketOwner: "123456789012",
        ObjectConfig: { Key: "k", Format: "JSON_LINES" },
      },
    });
  });

  it("rejects an expectedBucketOwner that is not exactly 12 digits", () => {
    const opts: DistributedMapS3SourceConfig = { expectedBucketOwner: "12345" };
    expect(() => DistributedMapSource.s3.jsonLines("s3://b/k", opts)).toThrow(
      /12 digits/,
    );
    expect(() =>
      DistributedMapSource.s3.objects("s3://b/p/", {
        expectedBucketOwner: "12345678901a",
      }),
    ).toThrow(/12 digits/);
  });
});

describe("Distributed map CSV source columns", () => {
  it("maps headers to a GIVEN header location", () => {
    expect(
      s3Wire(
        DistributedMapSource.s3.csv("s3://b/k", {
          headers: ["a"],
          delimiter: "TAB",
        }),
      ),
    ).toMatchObject({
      ObjectConfig: {
        CsvFormatOptions: {
          HeaderLocation: "GIVEN",
          Headers: ["a"],
          Delimiter: "TAB",
        },
      },
    });
  });

  it("sends a FIRST_ROW header location and no names for expectedColumns", () => {
    const wire = s3Wire(
      DistributedMapSource.s3.csv("s3://b/k", { expectedColumns: ["a"] }),
    );
    // toEqual on the whole CSV options block, so a Headers key would fail the test.
    expect((wire as any).ObjectConfig.CsvFormatOptions).toEqual({
      HeaderLocation: "FIRST_ROW",
      Delimiter: "COMMA",
    });
  });

  it("accepts as const column arrays", () => {
    const columns = ["id", "name"] as const;
    expect(() =>
      DistributedMapSource.s3.csv("s3://b/k", { expectedColumns: columns }),
    ).not.toThrow();
    expect(() =>
      DistributedMapSource.s3.flattenedCsv("s3://b/p/", { headers: columns }),
    ).not.toThrow();
  });

  it("rejects empty or duplicate columns", () => {
    expect(() =>
      DistributedMapSource.s3.csv("s3://b/k", { headers: [] }),
    ).toThrow(/non-empty/);
    expect(() =>
      DistributedMapSource.s3.csv("s3://b/k", { headers: ["a", "a"] }),
    ).toThrow(/duplicates/);
  });

  it("rejects more than 1,000 columns or a column name over 256 characters", () => {
    const columns = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    expect(() =>
      DistributedMapSource.s3.csv("s3://b/k", { expectedColumns: columns }),
    ).toThrow(/at most 1000 names/);
    expect(() =>
      DistributedMapSource.s3.csv("s3://b/k", {
        headers: columns.slice(0, 1000),
      }),
    ).not.toThrow();
    expect(() =>
      DistributedMapSource.s3.flattenedCsv("s3://b/p/", {
        headers: ["a".repeat(257)],
      }),
    ).toThrow(/at most 256 characters/);
    expect(() =>
      DistributedMapSource.s3.csv("s3://b/k", { headers: ["a".repeat(256)] }),
    ).not.toThrow();
  });
});

describe("Distributed map inline and reader source factories", () => {
  it("keeps inline items unserialized with their serdes and max items", () => {
    const serdes = {
      serialize: async (v?: number): Promise<string> => String(v),
      deserialize: async (d?: string): Promise<number> => Number(d),
    };
    expect(
      DistributedMapSource.inline([1, 2], { serdes, maxItems: 1 }).definition,
    ).toEqual({ type: "INLINE", items: [1, 2], serdes, maxItems: 1 });
  });

  it("rejects inline items that are not an array", () => {
    expect(() => DistributedMapSource.inline("x" as never)).toThrow(
      /must be an array/,
    );
  });

  it("builds a reader source", () => {
    expect(
      DistributedMapSource.reader.fromFunction("reader-fn", {
        initialState: { page: 0 },
      }).definition,
    ).toMatchObject({
      type: "READER_FUNCTION",
      functionName: "reader-fn",
      initialState: { page: 0 },
    });
  });

  it("rejects a maxItems that is not an integer from 1 through 100,000,000", () => {
    const range = /integer from 1 through 100000000/;
    expect(() => DistributedMapSource.inline([], { maxItems: 0 })).toThrow(
      range,
    );
    expect(() =>
      DistributedMapSource.reader.fromFunction("fn", { maxItems: 1.5 }),
    ).toThrow(range);
    expect(() =>
      DistributedMapSource.s3.jsonLines("s3://b/k", {
        maxItems: 100_000_001,
      }),
    ).toThrow(range);
    expect(() =>
      DistributedMapSource.inline([], { maxItems: 100_000_000 }),
    ).not.toThrow();
  });
});

describe("Distributed map function-name validation", () => {
  it("accepts a bare name, a qualified name, and a full ARN within the limit", () => {
    for (const name of [
      "my-fn",
      "my-fn:PROD",
      "arn:aws:lambda:us-east-1:123456789012:function:my-fn",
      "a".repeat(170),
    ]) {
      expect(() =>
        DistributedMapProcessor.reportBatchOutcome(name),
      ).not.toThrow();
    }
  });

  it("rejects an empty name", () => {
    expect(() => DistributedMapProcessor.reportItemOutcomes("")).toThrow(
      /non-empty/,
    );
    expect(() => DistributedMapSource.reader.fromFunction("")).toThrow(
      /non-empty/,
    );
  });

  it("rejects a name longer than 170 characters", () => {
    expect(() =>
      DistributedMapProcessor.reportBatchOutcome("a".repeat(171)),
    ).toThrow(/170/);
    expect(() =>
      DistributedMapSource.reader.fromFunction("a".repeat(171)),
    ).toThrow(/170/);
  });
});

describe("Distributed map processor factories", () => {
  it("sends no response type for reportBatchOutcome", () => {
    expect(DistributedMapProcessor.reportBatchOutcome("fn").options).toEqual({
      FunctionName: "fn",
    });
  });

  it("sends REPORT_BATCH_ITEM_OUTCOMES for reportItemOutcomes", () => {
    expect(
      DistributedMapProcessor.reportItemOutcomes("fn").options
        .FunctionResponseTypes,
    ).toEqual(["REPORT_BATCH_ITEM_OUTCOMES"]);
  });

  it("maps the processor options to the wire", () => {
    expect(
      DistributedMapProcessor.reportItemOutcomes("fn", {
        batchSize: 10,
        retry: {
          maxRetryAttempts: "unlimited",
          maxRetryDuration: { minutes: 5 },
        },
        durableExecutionNamePrefix: "p",
      }).options,
    ).toEqual({
      FunctionName: "fn",
      FunctionResponseTypes: ["REPORT_BATCH_ITEM_OUTCOMES"],
      BatchSize: 10,
      MaxRetryAttempts: -1,
      MaxRetryDurationSeconds: 300,
      DurableExecutionNamePrefix: "p",
    });
  });

  it("sends a retry duration without a retry attempt count", () => {
    const options = DistributedMapProcessor.reportBatchOutcome("fn", {
      retry: { maxRetryDuration: { minutes: 5 } },
    }).options;
    expect(options.MaxRetryDurationSeconds).toBe(300);
    expect(options.MaxRetryAttempts).toBeUndefined();
  });

  it("accepts a zero retry attempt count", () => {
    expect(
      DistributedMapProcessor.reportBatchOutcome("fn", {
        retry: { maxRetryAttempts: 0 },
      }).options.MaxRetryAttempts,
    ).toBe(0);
  });

  it("rejects a batchSize outside 1 to 10000", () => {
    expect(() =>
      DistributedMapProcessor.reportBatchOutcome("fn", { batchSize: 0 }),
    ).toThrow(/between 1 and 10000/);
    expect(() =>
      DistributedMapProcessor.reportBatchOutcome("fn", { batchSize: 10001 }),
    ).toThrow(/between 1 and 10000/);
  });

  it("rejects a retry duration outside 1 minute to 6 hours", () => {
    expect(() =>
      DistributedMapProcessor.reportBatchOutcome("fn", {
        retry: { maxRetryDuration: { seconds: 30 } },
      }),
    ).toThrow(/1 minute and 6 hours/);
  });

  it("rejects a negative retry attempt count", () => {
    expect(() =>
      DistributedMapProcessor.reportBatchOutcome("fn", {
        retry: { maxRetryAttempts: -1 },
      }),
    ).toThrow(/non-negative integer/);
  });

  it("rejects an empty, over-long or non-string durableExecutionNamePrefix", () => {
    expect(() =>
      DistributedMapProcessor.reportBatchOutcome("fn", {
        durableExecutionNamePrefix: "",
      }),
    ).toThrow(/1 to 36 characters/);
    expect(() =>
      DistributedMapProcessor.reportBatchOutcome("fn", {
        durableExecutionNamePrefix: "a".repeat(37),
      }),
    ).toThrow(/1 to 36 characters/);
    expect(() =>
      DistributedMapProcessor.reportBatchOutcome("fn", {
        durableExecutionNamePrefix: 42 as unknown as string,
      }),
    ).toThrow(/must be a string/);
  });

  it("rejects a retry option that is not an object", () => {
    for (const retry of [null, 3, [], "x"]) {
      expect(() =>
        DistributedMapProcessor.reportBatchOutcome("fn", {
          retry: retry as unknown as DistributedMapProcessorRetryConfig,
        }),
      ).toThrow(/retry must be an object/);
    }
  });

  it("rejects a NaN or fractional maxRetryDuration", () => {
    for (const seconds of [NaN, 90.5]) {
      expect(() =>
        DistributedMapProcessor.reportBatchOutcome("fn", {
          retry: { maxRetryDuration: { seconds } },
        }),
      ).toThrow(/whole number of seconds/);
    }
  });
});

describe("Distributed map CSV delimiter validation", () => {
  it("rejects a delimiter outside the allowed values", () => {
    expect(() =>
      DistributedMapSource.s3.csv("s3://b/k.csv", {
        delimiter: "COLON" as unknown as "COMMA",
      }),
    ).toThrow(/delimiter must be one of/);
  });
});

describe("Distributed map destination factories", () => {
  it("applies the include defaults", () => {
    expect(
      DistributedMapDestination.s3.successes("s3://b/out/").options,
    ).toEqual({
      Type: "S3",
      Include: ["OUTPUT"],
      S3DestinationConfig: { Bucket: "b", KeyPrefix: "out/" },
    });
    expect(
      DistributedMapDestination.s3.failures("s3://b/err/").options.Include,
    ).toEqual(["INPUT", "ERROR"]);
  });

  it("tags each destination with the factory that built it", () => {
    expect(DistributedMapDestination.s3.successes("s3://b/out/").__kind).toBe(
      "success",
    );
    expect(DistributedMapDestination.s3.failures("s3://b/err/").__kind).toBe(
      "failure",
    );
  });

  it("sends the expected bucket owner", () => {
    expect(
      DistributedMapDestination.s3.failures("s3://b/err/", {
        expectedBucketOwner: "123456789012",
      }).options.S3DestinationConfig.ExpectedBucketOwner,
    ).toBe("123456789012");
  });

  it("rejects a success destination that includes neither input nor output", () => {
    expect(() =>
      DistributedMapDestination.s3.successes("s3://b/out/", {
        includeOutput: false,
      }),
    ).toThrow(/at least one of input or output/);
  });

  it("rejects a failure destination that includes neither input nor error", () => {
    expect(() =>
      DistributedMapDestination.s3.failures("s3://b/err/", {
        includeInput: false,
        includeError: false,
      }),
    ).toThrow(/at least one of input or error/);
  });

  it("rejects a bad URI and a bad expectedBucketOwner", () => {
    expect(() => DistributedMapDestination.s3.successes("b/out/")).toThrow(
      /s3:\/\//,
    );
    expect(() =>
      DistributedMapDestination.s3.failures("s3://b/err/", {
        expectedBucketOwner: "1",
      }),
    ).toThrow(/12 digits/);
  });

  it("accepts a 900-byte key prefix and rejects 901", () => {
    expect(() =>
      DistributedMapDestination.s3.successes(`s3://b/${"p".repeat(900)}`),
    ).not.toThrow();
    expect(() =>
      DistributedMapDestination.s3.failures(`s3://b/${"p".repeat(901)}`),
    ).toThrow("at most 900 UTF-8 bytes (got 901)");
  });

  it("counts the key prefix in UTF-8 bytes, not characters", () => {
    // "é" is 2 UTF-8 bytes, so 450 of them are 900 bytes and 451 are 902.
    expect(() =>
      DistributedMapDestination.s3.successes(`s3://b/${"é".repeat(450)}`),
    ).not.toThrow();
    expect(() =>
      DistributedMapDestination.s3.successes(`s3://b/${"é".repeat(451)}`),
    ).toThrow("at most 900 UTF-8 bytes (got 902)");
  });
});

describe("Distributed map compile-time checks", () => {
  it("does not type-check a destination assigned to the wrong outcome", () => {
    const config: DistributedMapDestinationConfig = {
      // @ts-expect-error A FailureDestination cannot be assigned to onSuccess.
      onSuccess: DistributedMapDestination.s3.failures("s3://b/err/"),
      // @ts-expect-error A SuccessDestination cannot be assigned to onFailure.
      onFailure: DistributedMapDestination.s3.successes("s3://b/out/"),
    };
    expect(config).toBeDefined();
  });

  it("does not type-check headers and expectedColumns together", () => {
    expect(() =>
      DistributedMapSource.s3.csv("s3://b/k", {
        headers: ["a"],
        // @ts-expect-error headers and expectedColumns are mutually exclusive.
        expectedColumns: ["a"],
      }),
    ).toThrow(/mutually exclusive/);
  });

  it("carries the declared output type on the processor", () => {
    const processor = DistributedMapProcessor.reportItemOutcomes<number>("fn");
    // @ts-expect-error The processor's output type is number, not string.
    const wrong: DistributedMapProcessor<string> = processor;
    const batch: DistributedMapProcessor<never> =
      DistributedMapProcessor.reportBatchOutcome("fn");
    expect([wrong, batch]).toHaveLength(2);
  });
});

describe("Distributed map call-site shape checks", () => {
  it("accepts an array and every source factory's result", () => {
    expect(() => assertSource([1, 2])).not.toThrow();
    expect(() => assertSource(DistributedMapSource.inline([1]))).not.toThrow();
    expect(() =>
      assertSource(DistributedMapSource.s3.jsonLines("s3://b/k")),
    ).not.toThrow();
    expect(() =>
      assertSource(DistributedMapSource.reader.fromFunction("fn")),
    ).not.toThrow();
  });

  it("rejects a source not built by a factory", () => {
    expect(() => assertSource({ inline: { items: [] } })).toThrow(
      /Invalid source/,
    );
    expect(() => assertSource(42)).toThrow(/Invalid source/);
    expect(() => assertSource(undefined)).toThrow(/Invalid source/);
  });

  it("rejects a processor not built by a factory", () => {
    expect(() =>
      assertProcessor(DistributedMapProcessor.reportBatchOutcome("fn")),
    ).not.toThrow();
    expect(() => assertProcessor({ functionName: "fn" })).toThrow(
      /Invalid processor/,
    );
    expect(() => assertProcessor("fn")).toThrow(/Invalid processor/);
  });

  it("rejects a destination built by the other factory", () => {
    expect(() => assertDestination(undefined)).not.toThrow();
    expect(() =>
      assertDestination({
        onSuccess: DistributedMapDestination.s3.successes("s3://b/out/"),
        onFailure: DistributedMapDestination.s3.failures("s3://b/err/"),
      }),
    ).not.toThrow();
    expect(() =>
      assertDestination({
        onSuccess: DistributedMapDestination.s3.failures(
          "s3://b/err/",
        ) as unknown as SuccessDestination,
      }),
    ).toThrow(
      /onSuccess must be built with DistributedMapDestination.s3.successes/,
    );
    expect(() =>
      assertDestination({
        onFailure: { bucket: "b" } as unknown as FailureDestination,
      }),
    ).toThrow(
      /onFailure must be built with DistributedMapDestination.s3.failures/,
    );
  });

  it("rejects an input-only destination built by the other factory", () => {
    // An input-only include list is valid for both factories, so only __kind tells them apart.
    expect(() =>
      assertDestination({
        onFailure: DistributedMapDestination.s3.successes("s3://b/out/", {
          includeInput: true,
          includeOutput: false,
        }) as unknown as FailureDestination,
      }),
    ).toThrow(
      /onFailure must be built with DistributedMapDestination.s3.failures/,
    );
    expect(() =>
      assertDestination({
        onSuccess: DistributedMapDestination.s3.failures("s3://b/err/", {
          includeInput: true,
          includeError: false,
        }) as unknown as SuccessDestination,
      }),
    ).toThrow(
      /onSuccess must be built with DistributedMapDestination.s3.successes/,
    );
  });
});

describe("Distributed map completion config validation", () => {
  it("accepts an absent config, a count form, and a percentage form", () => {
    expect(() => assertCompletionConfig(undefined)).not.toThrow();
    expect(() =>
      assertCompletionConfig({ toleratedFailureCount: 0 }),
    ).not.toThrow();
    expect(() =>
      assertCompletionConfig({
        toleratedFailurePercentage: 10,
        minimumSampleSize: 50,
      }),
    ).not.toThrow();
  });

  it("rejects count and percentage set together", () => {
    expect(() =>
      assertCompletionConfig({
        toleratedFailureCount: 1,
        toleratedFailurePercentage: 10,
      } as unknown as DistributedMapCompletionConfig),
    ).toThrow(/mutually exclusive/);
  });

  it("rejects minimumSampleSize without a percentage", () => {
    expect(() =>
      assertCompletionConfig({
        minimumSampleSize: 50,
      } as unknown as DistributedMapCompletionConfig),
    ).toThrow(/minimumSampleSize/);
  });

  it("rejects a config with neither threshold", () => {
    expect(() =>
      assertCompletionConfig({} as unknown as DistributedMapCompletionConfig),
    ).toThrow(/must set toleratedFailureCount or toleratedFailurePercentage/);
  });

  it("accepts a fractional percentage", () => {
    expect(() =>
      assertCompletionConfig({ toleratedFailurePercentage: 12.5 }),
    ).not.toThrow();
  });

  it.each([NaN, Infinity])("rejects a %s percentage", (pct) => {
    expect(() =>
      assertCompletionConfig({ toleratedFailurePercentage: pct }),
    ).toThrow(/Must be a number from 0 through 100/);
  });

  it("rejects a negative count", () => {
    expect(() => assertCompletionConfig({ toleratedFailureCount: -1 })).toThrow(
      /non-negative integer/,
    );
  });

  it("rejects a percentage outside 0 to 100", () => {
    expect(() =>
      assertCompletionConfig({ toleratedFailurePercentage: 101 }),
    ).toThrow(/Invalid toleratedFailurePercentage: 101/);
  });

  it("rejects a minimumSampleSize below 1", () => {
    expect(() =>
      assertCompletionConfig({
        toleratedFailurePercentage: 10,
        minimumSampleSize: 0,
      }),
    ).toThrow(/at least 1/);
  });
});
