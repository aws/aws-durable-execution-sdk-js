import type { Duration } from "./core";
import type { Serdes, AnySerdes } from "../utils/serdes/serdes";
import { durationToSeconds } from "../utils/duration/duration";
import type {
  DistributedMapDestinationEntryOptions,
  DistributedMapDestinationInclude,
  DistributedMapFunctionResponseType,
  DistributedMapProcessorOptions,
  DistributedMapCsvFormatOptions,
  DistributedMapS3Format,
  DistributedMapS3SourceOptions,
  ErrorObject,
} from "./wire";
// Type-only import to avoid a runtime circular dependency with errors/durable-error.
import type { DistributedMapItemError } from "../errors/durable-error/durable-error";

/** Terminal status of a distributed map run. @public */
export enum DistributedMapStatus {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  STOPPED = "STOPPED",
  TIMED_OUT = "TIMED_OUT",
  // Client-side sentinel for an unrecognized status from backend.
  UNKNOWN_TO_SDK_VERSION = "UNKNOWN_TO_SDK_VERSION",
}

/** Status of a single item in a collected distributed map result. @public */
export enum DistributedMapItemStatus {
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  // Client-side sentinel for an unrecognized status from backend.
  UNKNOWN_TO_SDK_VERSION = "UNKNOWN_TO_SDK_VERSION",
}

/** CSV field delimiter. @public */
export type CsvDelimiter = "COMMA" | "PIPE" | "SEMICOLON" | "SPACE" | "TAB";

const CSV_DELIMITERS: ReadonlySet<string> = new Set<CsvDelimiter>([
  "COMMA",
  "PIPE",
  "SEMICOLON",
  "SPACE",
  "TAB",
]);

/** Failure tolerance for the run, count and percentage are mutually exclusive. @public */
export type DistributedMapCompletionConfig =
  | {
      toleratedFailureCount: number;
      toleratedFailurePercentage?: never;
      minimumSampleSize?: never;
    }
  | {
      toleratedFailurePercentage: number;
      minimumSampleSize?: number;
      toleratedFailureCount?: never;
    };

/** Options for an inline source. @public */
export interface DistributedMapInlineSourceConfig<TItem> {
  /**
   * Serializes each item. Must match the item serdes the processor uses. Defaults to JSON.
   * Must produce a payload that can be deserialized without the original context.
   */
  serdes?: Serdes<TItem>;
  /** Maximum number of items the service reads from the source. */
  maxItems?: number;
}

/** Options for an S3 source. @public */
export interface DistributedMapS3SourceConfig {
  /** Account ID that must own the bucket, as exactly 12 digits. */
  expectedBucketOwner?: string;
  /** Maximum number of items the service reads from the source. */
  maxItems?: number;
}

/**
 * Column options for a CSV source. A headered file is a file whose first row is a header row.
 * Pass headers for a file with no header row, or expectedColumns for a headered file.
 * The two options are mutually exclusive.
 *
 * @public
 */
export type DistributedMapCsvColumns =
  | {
      /** Column names for a file with no header row. The first row is read as data. */
      headers: readonly string[];
      expectedColumns?: never;
    }
  | {
      /**
       * Column names of a headered file. The service never receives them. A missing column
       * reads as null.
       *
       * @example Type the row in the processor from the same names
       * ```ts
       * const columns = ["id", "name"] as const;
       * type OrderRow = { [K in (typeof columns)[number]]: string | null };
       * ```
       */
      expectedColumns: readonly string[];
      headers?: never;
    }
  | { headers?: never; expectedColumns?: never };

/** Options for a CSV source. @public */
export type DistributedMapCsvConfig = DistributedMapS3SourceConfig &
  DistributedMapCsvColumns & {
    /** Field delimiter. Defaults to COMMA. */
    delimiter?: CsvDelimiter;
  };

/** Options for a reader function source. @public */
export interface DistributedMapReaderSourceConfig<TState> {
  /** State passed to the reader's first call. */
  initialState?: TState;
  /**
   * Serializes initialState. Must match the state serdes the reader uses. Defaults to JSON.
   * Must produce a payload that can be deserialized without the original context.
   */
  stateSerdes?: Serdes<TState>;
  /** Maximum number of items the service reads from the source. */
  maxItems?: number;
}

/**
 * Normalized source that the handler converts to the checkpoint's source options. Inline items
 * and reader state are serialized when the operation starts, so they are kept unserialized here.
 *
 * @internal
 */
export type DistributedMapSourceDefinition =
  | {
      type: "INLINE";
      items: unknown[];
      serdes?: AnySerdes | undefined;
      maxItems?: number | undefined;
    }
  | {
      type: "S3";
      s3: DistributedMapS3SourceOptions;
      maxItems?: number | undefined;
    }
  | {
      type: "READER_FUNCTION";
      functionName: string;
      initialState?: unknown;
      stateSerdes?: AnySerdes | undefined;
      maxItems?: number | undefined;
    };

/**
 * Where a distributed map run reads its items. Build one with the factories on
 * {@link (DistributedMapSource:variable)}, or pass a plain array as an inline source.
 *
 * @public
 */
export interface DistributedMapSource<TItem> {
  /** @internal */
  readonly definition: DistributedMapSourceDefinition;
  /**
   * Carries the item type so distributedMap can infer it. Never set at runtime.
   * @internal
   */
  readonly __item?: TItem;
}

/** Retry settings for a processor. @public */
export interface DistributedMapProcessorRetryConfig {
  /** Retries per item, a non-negative integer or "unlimited". 0 disables retries. Defaults to 2. */
  maxRetryAttempts?: number | "unlimited";
  /** Total retry time per item, from 1 minute through 6 hours. Defaults to 6 hours. */
  maxRetryDuration?: Duration;
}

/** Options for a processor. @public */
export interface DistributedMapProcessorConfig {
  /** Items per processor call, from 1 through 10000. */
  batchSize?: number;
  /** Retry settings for failed items. */
  retry?: DistributedMapProcessorRetryConfig;
  /** Name prefix for durable processor executions, 1 to 36 characters. */
  durableExecutionNamePrefix?: string;
}

/**
 * The Lambda function that processes batches of items. Build one with the factories on
 * {@link (DistributedMapProcessor:variable)}.
 *
 * @public
 */
export interface DistributedMapProcessor<TOutput> {
  /** @internal */
  readonly options: DistributedMapProcessorOptions;
  /**
   * Carries the output type so distributedMap can infer the result type. Never set at runtime.
   * @internal
   */
  readonly __output?: TOutput;
}

/** Options for an S3 destination for succeeded items. @public */
export interface DistributedMapSuccessDestinationConfig {
  /** Write each item's input. Defaults to false. */
  includeInput?: boolean;
  /** Write each item's output. Defaults to true. */
  includeOutput?: boolean;
  /** Account ID that must own the bucket, as exactly 12 digits. */
  expectedBucketOwner?: string;
}

/** Options for an S3 destination for failed items. @public */
export interface DistributedMapFailureDestinationConfig {
  /** Write each item's input. Defaults to true. */
  includeInput?: boolean;
  /** Write each item's error. Defaults to true. */
  includeError?: boolean;
  /** Account ID that must own the bucket, as exactly 12 digits. */
  expectedBucketOwner?: string;
}

/**
 * Where the service writes records for succeeded items. Build one with
 * `DistributedMapDestination.s3.successes`.
 *
 * @public
 */
export interface SuccessDestination {
  /** @internal */
  readonly options: DistributedMapDestinationEntryOptions;
  /**
   * Set by DistributedMapDestination.s3.successes. assertDestination checks it, and the type
   * stops a SuccessDestination from being assigned to onFailure.
   * @internal
   */
  readonly __kind: "success";
}

/**
 * Where the service writes records for failed items. Build one with
 * `DistributedMapDestination.s3.failures`.
 *
 * @public
 */
export interface FailureDestination {
  /** @internal */
  readonly options: DistributedMapDestinationEntryOptions;
  /**
   * Set by DistributedMapDestination.s3.failures. assertDestination checks it, and the type
   * stops a FailureDestination from being assigned to onSuccess.
   * @internal
   */
  readonly __kind: "failure";
}

/** Where the service writes item input, output, and error records. @public */
export interface DistributedMapDestinationConfig {
  onSuccess?: SuccessDestination;
  onFailure?: FailureDestination;
}

const TWELVE_DIGITS = /^[0-9]{12}$/;

function assertBucketOwner(owner?: string): void {
  if (owner !== undefined && !TWELVE_DIGITS.test(owner)) {
    throw new Error("expectedBucketOwner must be exactly 12 digits");
  }
}

/** The service enforces the full Lambda name grammar. The SDK only bounds length. */
const FUNCTION_NAME_MAX = 170;

function assertFunctionName(name: unknown): void {
  if (typeof name !== "string" || !name)
    throw new Error("function name must be non-empty");
  if (name.length > FUNCTION_NAME_MAX) {
    throw new Error(
      `function name must be at most ${FUNCTION_NAME_MAX} characters`,
    );
  }
}

const MAX_ITEMS_TO_READ = 100_000_000;

function assertMaxItems(maxItems?: number): void {
  if (
    maxItems !== undefined &&
    (!Number.isInteger(maxItems) ||
      maxItems < 1 ||
      maxItems > MAX_ITEMS_TO_READ)
  ) {
    throw new Error(
      `maxItems must be an integer from 1 through ${MAX_ITEMS_TO_READ}`,
    );
  }
}

const MAX_CSV_COLUMNS = 1000;
const MAX_CSV_COLUMN_LENGTH = 256;

function assertCsvColumns(csv: {
  headers?: readonly string[];
  expectedColumns?: readonly string[];
}): void {
  if (csv.headers && csv.expectedColumns) {
    throw new Error("headers and expectedColumns are mutually exclusive");
  }
  for (const [label, cols] of [
    ["headers", csv.headers],
    ["expectedColumns", csv.expectedColumns],
  ] as const) {
    if (cols) {
      if (cols.length === 0) throw new Error(`${label} must be non-empty`);
      if (cols.length > MAX_CSV_COLUMNS) {
        throw new Error(
          `${label} must hold at most ${MAX_CSV_COLUMNS} names, got ${cols.length}`,
        );
      }
      if (cols.some((c) => c.length > MAX_CSV_COLUMN_LENGTH)) {
        throw new Error(
          `each ${label} name must be at most ${MAX_CSV_COLUMN_LENGTH} characters`,
        );
      }
      if (new Set(cols).size !== cols.length) {
        throw new Error(`${label} must not contain duplicates`);
      }
    }
  }
}

/** Splits an s3:// URI into the bucket and the text after the first slash. */
function parseS3Uri(uri: string): { bucket: string; path: string } {
  if (typeof uri !== "string" || !uri.startsWith("s3://")) {
    throw new Error(`Invalid S3 URI (must start with s3://): ${String(uri)}`);
  }
  const withoutScheme = uri.slice("s3://".length);
  const slash = withoutScheme.indexOf("/");
  const bucket = slash === -1 ? withoutScheme : withoutScheme.slice(0, slash);
  if (!bucket) throw new Error(`Invalid S3 URI (missing bucket): ${uri}`);
  return { bucket, path: slash === -1 ? "" : withoutScheme.slice(slash + 1) };
}

type S3SourceOpts = DistributedMapS3SourceConfig & {
  headers?: readonly string[];
  expectedColumns?: readonly string[];
  delimiter?: CsvDelimiter;
};

/** Validates the options every S3 source accepts and splits the URI. */
function s3SourceBase(
  uri: string,
  format: DistributedMapS3Format | undefined,
  opts: S3SourceOpts,
): {
  base: Pick<DistributedMapS3SourceOptions, "Bucket" | "ExpectedBucketOwner">;
  path: string;
  csv?: DistributedMapCsvFormatOptions;
} {
  assertBucketOwner(opts.expectedBucketOwner);
  assertMaxItems(opts.maxItems);
  if (format === "CSV") {
    assertCsvColumns(opts);
    if (opts.delimiter !== undefined && !CSV_DELIMITERS.has(opts.delimiter)) {
      throw new Error(
        `delimiter must be one of ${[...CSV_DELIMITERS].join(", ")}`,
      );
    }
  }
  const { bucket, path } = parseS3Uri(uri);
  return {
    base: {
      Bucket: bucket,
      ...(opts.expectedBucketOwner
        ? { ExpectedBucketOwner: opts.expectedBucketOwner }
        : {}),
    },
    path,
    ...(format === "CSV"
      ? {
          csv: {
            HeaderLocation: opts.headers ? "GIVEN" : "FIRST_ROW",
            ...(opts.headers ? { Headers: [...opts.headers] } : {}),
            Delimiter: opts.delimiter ?? "COMMA",
          },
        }
      : {}),
  };
}

/** Builds an OBJECT source, which reads the one object at the URI. */
function s3ObjectSource<TItem>(
  uri: string,
  format: DistributedMapS3Format,
  opts: S3SourceOpts = {},
): DistributedMapSource<TItem> {
  const { base, path, csv } = s3SourceBase(uri, format, opts);
  if (!path) throw new Error(`S3 object source requires a key: ${uri}`);
  return {
    definition: {
      type: "S3",
      maxItems: opts.maxItems,
      s3: {
        Type: "OBJECT",
        ...base,
        ObjectConfig: {
          Key: path,
          Format: format,
          ...(csv ? { CsvFormatOptions: csv } : {}),
        },
      },
    },
  };
}

/** Builds a LISTED_OBJECTS source, which reads every object under the prefix. */
function s3ListedObjectsSource<TItem>(
  prefixUri: string,
  format: DistributedMapS3Format,
  opts: S3SourceOpts = {},
): DistributedMapSource<TItem> {
  const { base, path, csv } = s3SourceBase(prefixUri, format, opts);
  return {
    definition: {
      type: "S3",
      maxItems: opts.maxItems,
      s3: {
        Type: "LISTED_OBJECTS",
        ...base,
        ListedObjectsConfig: {
          KeyPrefix: path,
          Format: format,
          ...(csv ? { CsvFormatOptions: csv } : {}),
        },
      },
    },
  };
}

/** Factories for a distributed map source. @public */
export const DistributedMapSource = {
  /** Items supplied in the operation request. The serialized items must total at most 1 MB. */
  inline<TItem>(
    items: TItem[],
    opts?: DistributedMapInlineSourceConfig<TItem>,
  ): DistributedMapSource<TItem> {
    if (!Array.isArray(items))
      throw new Error("inline source items must be an array");
    assertMaxItems(opts?.maxItems);
    return {
      definition: {
        type: "INLINE",
        items,
        serdes: opts?.serdes as AnySerdes | undefined,
        maxItems: opts?.maxItems,
      },
    };
  },

  /** Sources read from S3. Each factory fixes whether the URI is an object key or a prefix. */
  s3: {
    /** One S3 object. Each line is an item. */
    jsonLines<TItem = unknown>(
      uri: string,
      opts?: DistributedMapS3SourceConfig,
    ): DistributedMapSource<TItem> {
      return s3ObjectSource<TItem>(uri, "JSON_LINES", opts);
    },
    /** One S3 object holding a JSON array. Each element is an item. */
    jsonArray<TItem = unknown>(
      uri: string,
      opts?: DistributedMapS3SourceConfig,
    ): DistributedMapSource<TItem> {
      return s3ObjectSource<TItem>(uri, "JSON_ARRAY", opts);
    },
    /** One S3 object in CSV format. Each record is an item. */
    csv<TItem = Record<string, string | null>>(
      uri: string,
      opts?: DistributedMapCsvConfig,
    ): DistributedMapSource<TItem> {
      return s3ObjectSource<TItem>(uri, "CSV", opts);
    },
    /** Every object under a prefix. Each object's key and metadata is an item. Contents are not read. */
    objects<TItem = unknown>(
      prefixUri: string,
      opts?: DistributedMapS3SourceConfig,
    ): DistributedMapSource<TItem> {
      const { base, path } = s3SourceBase(prefixUri, undefined, opts ?? {});
      return {
        definition: {
          type: "S3",
          maxItems: opts?.maxItems,
          s3: {
            Type: "LISTED_OBJECT_METADATA",
            ...base,
            ListedObjectMetadataConfig: { KeyPrefix: path },
          },
        },
      };
    },
    /** Every object under a prefix. Each line of every object is an item. */
    flattenedJsonLines<TItem = unknown>(
      prefixUri: string,
      opts?: DistributedMapS3SourceConfig,
    ): DistributedMapSource<TItem> {
      return s3ListedObjectsSource<TItem>(prefixUri, "JSON_LINES", opts);
    },
    /** Every object under a prefix, each holding a JSON array. Each element is an item. */
    flattenedJsonArray<TItem = unknown>(
      prefixUri: string,
      opts?: DistributedMapS3SourceConfig,
    ): DistributedMapSource<TItem> {
      return s3ListedObjectsSource<TItem>(prefixUri, "JSON_ARRAY", opts);
    },
    /** Every object under a prefix in CSV format. Each record of every object is an item. */
    flattenedCsv<TItem = Record<string, string | null>>(
      prefixUri: string,
      opts?: DistributedMapCsvConfig,
    ): DistributedMapSource<TItem> {
      return s3ListedObjectsSource<TItem>(prefixUri, "CSV", opts);
    },
  },

  /** Sources read by calling a reader Lambda function. */
  reader: {
    /** A reader function that returns items one page at a time. */
    fromFunction<TItem = unknown, TState = unknown>(
      functionName: string,
      opts?: DistributedMapReaderSourceConfig<TState>,
    ): DistributedMapSource<TItem> {
      assertFunctionName(functionName);
      assertMaxItems(opts?.maxItems);
      return {
        definition: {
          type: "READER_FUNCTION",
          functionName,
          initialState: opts?.initialState,
          stateSerdes: opts?.stateSerdes as AnySerdes | undefined,
          maxItems: opts?.maxItems,
        },
      };
    },
  },
};

const UNLIMITED_RETRY_WIRE = -1;

function processor<TOutput>(
  functionName: string,
  responseTypes: DistributedMapFunctionResponseType[] | undefined,
  opts: DistributedMapProcessorConfig = {},
): DistributedMapProcessor<TOutput> {
  assertFunctionName(functionName);
  const batchSize = opts.batchSize;
  if (
    batchSize !== undefined &&
    (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000)
  ) {
    throw new Error("batchSize must be an integer between 1 and 10000");
  }
  const retry = opts.retry;
  if (
    retry !== undefined &&
    (retry === null || typeof retry !== "object" || Array.isArray(retry))
  ) {
    throw new Error("retry must be an object");
  }
  const attempts = retry?.maxRetryAttempts;
  if (
    attempts !== undefined &&
    attempts !== "unlimited" &&
    (!Number.isInteger(attempts) || attempts < 0)
  ) {
    throw new Error(
      'retry.maxRetryAttempts must be a non-negative integer or "unlimited"',
    );
  }
  let maxRetryDurationSeconds: number | undefined;
  if (retry?.maxRetryDuration) {
    maxRetryDurationSeconds = durationToSeconds(retry.maxRetryDuration);
    if (
      !Number.isInteger(maxRetryDurationSeconds) ||
      maxRetryDurationSeconds < 60 ||
      maxRetryDurationSeconds > 6 * 60 * 60
    ) {
      throw new Error(
        "retry.maxRetryDuration must be a whole number of seconds between 1 minute and 6 hours",
      );
    }
  }
  const prefix = opts.durableExecutionNamePrefix;
  if (
    prefix !== undefined &&
    (typeof prefix !== "string" || prefix.length < 1 || prefix.length > 36)
  ) {
    throw new Error(
      "durableExecutionNamePrefix must be a string of 1 to 36 characters",
    );
  }
  return {
    options: {
      FunctionName: functionName,
      ...(responseTypes ? { FunctionResponseTypes: responseTypes } : {}),
      ...(batchSize !== undefined ? { BatchSize: batchSize } : {}),
      ...(attempts !== undefined
        ? {
            MaxRetryAttempts:
              attempts === "unlimited" ? UNLIMITED_RETRY_WIRE : attempts,
          }
        : {}),
      ...(maxRetryDurationSeconds !== undefined
        ? { MaxRetryDurationSeconds: maxRetryDurationSeconds }
        : {}),
      ...(prefix !== undefined ? { DurableExecutionNamePrefix: prefix } : {}),
    },
  };
}

/** Factories for a distributed map processor. @public */
export const DistributedMapProcessor = {
  /**
   * The function reports one outcome for the whole batch. Returning succeeds every item in the
   * batch, and throwing fails the batch. Pair it with a batch handler wrapper.
   */
  reportBatchOutcome(
    functionName: string,
    opts?: DistributedMapProcessorConfig,
  ): DistributedMapProcessor<never> {
    return processor<never>(functionName, undefined, opts);
  },
  /**
   * The function reports an outcome for each item: an output when the item succeeds, or an
   * error when it fails. Pair it with an item handler wrapper. TOutput is the item output type,
   * and defaults to never for a processor whose outputs are not collected.
   */
  reportItemOutcomes<TOutput = never>(
    functionName: string,
    opts?: DistributedMapProcessorConfig,
  ): DistributedMapProcessor<TOutput> {
    return processor<TOutput>(
      functionName,
      ["REPORT_BATCH_ITEM_OUTCOMES"],
      opts,
    );
  },
};

// The service rejects a destination KeyPrefix over 900 UTF-8 bytes, which fails the checkpoint.
// So the SDK rejects it when the destination is built.
const MAX_DESTINATION_KEY_PREFIX_BYTES = 900;

function s3Destination(
  prefixUri: string,
  include: DistributedMapDestinationInclude[],
  expectedBucketOwner: string | undefined,
): DistributedMapDestinationEntryOptions {
  assertBucketOwner(expectedBucketOwner);
  const { bucket, path } = parseS3Uri(prefixUri);
  const prefixBytes = Buffer.byteLength(path, "utf8");
  if (prefixBytes > MAX_DESTINATION_KEY_PREFIX_BYTES) {
    throw new Error(
      `destination key prefix must be at most ${MAX_DESTINATION_KEY_PREFIX_BYTES} UTF-8 bytes (got ${prefixBytes})`,
    );
  }
  return {
    Type: "S3",
    Include: include,
    S3DestinationConfig: {
      Bucket: bucket,
      KeyPrefix: path,
      ...(expectedBucketOwner
        ? { ExpectedBucketOwner: expectedBucketOwner }
        : {}),
    },
  };
}

/** Factories for distributed map destinations. @public */
export const DistributedMapDestination = {
  /** Destinations that write records to S3 objects under a prefix. */
  s3: {
    /** Writes a record for each succeeded item. */
    successes(
      prefixUri: string,
      opts?: DistributedMapSuccessDestinationConfig,
    ): SuccessDestination {
      const include: DistributedMapDestinationInclude[] = [];
      if (opts?.includeInput ?? false) include.push("INPUT");
      if (opts?.includeOutput ?? true) include.push("OUTPUT");
      if (include.length === 0) {
        throw new Error(
          "success destination must include at least one of input or output",
        );
      }
      return {
        __kind: "success",
        options: s3Destination(prefixUri, include, opts?.expectedBucketOwner),
      };
    },
    /** Writes a record for each failed item. */
    failures(
      prefixUri: string,
      opts?: DistributedMapFailureDestinationConfig,
    ): FailureDestination {
      const include: DistributedMapDestinationInclude[] = [];
      if (opts?.includeInput ?? true) include.push("INPUT");
      if (opts?.includeError ?? true) include.push("ERROR");
      if (include.length === 0) {
        throw new Error(
          "failure destination must include at least one of input or error",
        );
      }
      return {
        __kind: "failure",
        options: s3Destination(prefixUri, include, opts?.expectedBucketOwner),
      };
    },
  },
};

/** Validate a completion config's numeric bounds and mutual-exclusion rules. @internal */
export function assertCompletionConfig(
  c?: DistributedMapCompletionConfig,
): void {
  if (!c) return;
  const count = c.toleratedFailureCount;
  const pct = c.toleratedFailurePercentage;
  const sample = c.minimumSampleSize;
  if (count !== undefined && pct !== undefined) {
    throw new Error(
      "toleratedFailureCount and toleratedFailurePercentage are mutually exclusive",
    );
  }
  if (sample !== undefined && pct === undefined) {
    throw new Error(
      "minimumSampleSize is only valid with toleratedFailurePercentage",
    );
  }
  // Omitting the config means zero tolerated failures. A present config with neither
  // threshold would be left out of the checkpoint and resolve the same way, so reject it.
  if (count === undefined && pct === undefined) {
    throw new Error(
      "completionConfig must set toleratedFailureCount or toleratedFailurePercentage",
    );
  }
  if (count !== undefined && (!Number.isInteger(count) || count < 0)) {
    throw new Error(
      `Invalid toleratedFailureCount: ${count}. Must be a non-negative integer.`,
    );
  }
  // A fraction is valid, as it is for map. NaN passes both range comparisons, so check it is finite.
  if (pct !== undefined && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
    throw new Error(
      `Invalid toleratedFailurePercentage: ${pct}. Must be a number from 0 through 100.`,
    );
  }
  if (sample !== undefined && (!Number.isInteger(sample) || sample < 1)) {
    throw new Error(
      `Invalid minimumSampleSize: ${sample}. Must be at least 1.`,
    );
  }
}

const SOURCE_TYPES: ReadonlySet<string> = new Set([
  "INLINE",
  "S3",
  "READER_FUNCTION",
]);

/**
 * Rejects a source that is neither an array nor built by a source factory. The factories
 * validate their own arguments, so this checks only the shape.
 *
 * @internal
 */
export function assertSource(source: unknown): void {
  if (Array.isArray(source)) return;
  const type = (source as DistributedMapSource<unknown> | undefined)?.definition
    ?.type;
  if (typeof type !== "string" || !SOURCE_TYPES.has(type)) {
    throw new Error(
      "Invalid source: must be an array of items or built with a DistributedMapSource factory.",
    );
  }
}

/**
 * Rejects a processor that was not built by a processor factory.
 *
 * @internal
 */
export function assertProcessor(processor: unknown): void {
  const name = (processor as DistributedMapProcessor<unknown> | undefined)
    ?.options?.FunctionName;
  if (typeof name !== "string" || !name) {
    throw new Error(
      "Invalid processor: must be built with a DistributedMapProcessor factory.",
    );
  }
}

/**
 * Rejects a destination that was not built by the matching destination factory. Each factory
 * sets __kind, so the check compares it with the slot.
 *
 * @internal
 */
export function assertDestination(
  destination?: DistributedMapDestinationConfig,
): void {
  const check = (
    entry: { __kind?: string } | undefined,
    label: string,
    factory: string,
    kind: string,
  ): void => {
    if (entry !== undefined && entry?.__kind !== kind) {
      throw new Error(
        `Invalid destination: ${label} must be built with DistributedMapDestination.s3.${factory}.`,
      );
    }
  };
  check(destination?.onSuccess, "onSuccess", "successes", "success");
  check(destination?.onFailure, "onFailure", "failures", "failure");
}

/** Optional settings for a distributed map run. @public */
export type DistributedMapConfig<TOutput> = {
  destination?: DistributedMapDestinationConfig;
  completionConfig?: DistributedMapCompletionConfig;
  timeout?: Duration;
} & (
  | { collectResults?: false; resultSerdes?: never }
  | {
      collectResults: true;
      /** Must produce a payload that can be deserialized without the original context. */
      resultSerdes?: Serdes<TOutput>;
    }
);

/** Summary of a resolved distributed map run. @public */
export interface DistributedMapSummary {
  distributedMapRunArn?: string | undefined;
  status: DistributedMapStatus;
  /** True only when the service read the complete source. */
  sourceExhausted?: boolean | undefined;
  /** Why the run did not succeed, when the service recorded error details. */
  error?: ErrorObject | undefined;
  hasFailure: boolean;
  successCount: number;
  failureCount: number;
  readCount: number;
  totalCount?: number | undefined;
  /** Throws {@link DistributedMapError} when the run did not fully succeed. */
  throwIfError(): void;
}

/** A single item outcome in a collected distributed map result. @public */
export interface DistributedMapResultItem<TOutput> {
  itemId: string;
  status: DistributedMapItemStatus;
  result?: TOutput;
  error?: DistributedMapItemError | undefined;
}

/** A resolved distributed map run with per-item results (collectResults: true). @public */
export interface DistributedMapResult<TOutput> extends DistributedMapSummary {
  all: Array<DistributedMapResultItem<TOutput>>;
  /**
   * The succeeded items. Each item's `result` is typed `TOutput | undefined`, because a
   * succeeded item has no output when the processor reported none or returned `undefined`.
   */
  succeeded(): Array<
    DistributedMapResultItem<TOutput> & {
      status: DistributedMapItemStatus.SUCCEEDED;
    }
  >;
  failed(): Array<
    DistributedMapResultItem<TOutput> & {
      status: DistributedMapItemStatus.FAILED;
    }
  >;
  getResults(): Array<TOutput | undefined>;
  getErrors(): Array<DistributedMapItemError | undefined>;
}

/**
 * Passed to an item handler for each item. Frozen.
 * @public
 */
export interface DistributedMapItemContext {
  readonly distributedMapRunArn: string;
  readonly itemId: string;
}

/**
 * Passed to a batch handler for each batch. Frozen.
 * @public
 */
export interface DistributedMapBatchContext {
  readonly distributedMapRunArn: string;
  /** The item ids, in the same order as the items. */
  readonly itemIds: readonly string[];
}

/**
 * Passed to a reader on each call. Frozen.
 * @public
 */
export interface DistributedMapReaderContext {
  readonly distributedMapRunArn: string;
}
