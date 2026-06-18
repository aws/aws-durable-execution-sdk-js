import { SerdesContext } from "./serdes";
import {
  createFileSystemSerdes,
  FileSystemSerdesMode,
  FileSystemPathEncoding,
  PreviewMode,
  FieldMatchMode,
  buildPreview,
} from "./filesystem-serdes";
import { TEST_CONSTANTS } from "../../testing/test-constants";
import { createHash } from "node:crypto";

jest.mock("node:fs/promises", () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
}));

import { mkdir, writeFile, readFile } from "node:fs/promises";

const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

const mockContext: SerdesContext = {
  entityId: TEST_CONSTANTS.STEP_ID,
  durableExecutionArn: TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
};

const BASE_PATH = "/mnt/s3";
const ENCODED_ARN = encodeURIComponent(TEST_CONSTANTS.DURABLE_EXECUTION_ARN);
const EXPECTED_DIR = `${BASE_PATH}/${ENCODED_ARN}`;
const EXPECTED_FILE = `${EXPECTED_DIR}/${TEST_CONSTANTS.STEP_ID}.json`;

beforeEach(() => jest.clearAllMocks());

describe("createFileSystemSerdes", () => {
  describe("ALWAYS mode (default)", () => {
    const serdes = createFileSystemSerdes(BASE_PATH);

    it("should return undefined for undefined value", async () => {
      expect(await serdes.serialize(undefined, mockContext)).toBeUndefined();
    });

    it("should write value to file and return file pointer envelope", async () => {
      const value = { id: 1, name: "Alice" };
      const result = await serdes.serialize(value, mockContext);

      expect(mockMkdir).toHaveBeenCalledWith(EXPECTED_DIR, { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        EXPECTED_FILE,
        JSON.stringify(value),
        "utf-8",
      );
      expect(JSON.parse(result!)).toEqual({ file: EXPECTED_FILE });
    });

    it("should deserialize by reading file from pointer envelope", async () => {
      const value = { id: 1, name: "Alice" };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(value) as never);

      const envelope = JSON.stringify({ file: EXPECTED_FILE });
      const result = await serdes.deserialize(envelope, mockContext);

      expect(mockReadFile).toHaveBeenCalledWith(EXPECTED_FILE, "utf-8");
      expect(result).toEqual(value);
    });

    it("should return undefined for undefined data", async () => {
      expect(await serdes.deserialize(undefined, mockContext)).toBeUndefined();
    });
  });

  describe("OVERFLOW mode", () => {
    const serdes = createFileSystemSerdes(BASE_PATH, {
      storageMode: FileSystemSerdesMode.OVERFLOW,
    });

    it("should store small values inline", async () => {
      const value = { id: 1 };
      const result = await serdes.serialize(value, mockContext);

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(JSON.parse(result!)).toEqual({ data: JSON.stringify(value) });
    });

    it("should overflow large values to file", async () => {
      // Create a value that exceeds the 255KB threshold
      const value = { data: "x".repeat(256 * 1024) };
      const result = await serdes.serialize(value, mockContext);

      expect(mockWriteFile).toHaveBeenCalled();
      expect(JSON.parse(result!)).toEqual({ file: EXPECTED_FILE });
    });

    it("should deserialize inline data envelope", async () => {
      const value = { id: 1 };
      const envelope = JSON.stringify({ data: JSON.stringify(value) });
      const result = await serdes.deserialize(envelope, mockContext);

      expect(mockReadFile).not.toHaveBeenCalled();
      expect(result).toEqual(value);
    });

    it("should deserialize file pointer envelope", async () => {
      const value = { id: 1 };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(value) as never);

      const envelope = JSON.stringify({ file: EXPECTED_FILE });
      const result = await serdes.deserialize(envelope, mockContext);

      expect(mockReadFile).toHaveBeenCalledWith(EXPECTED_FILE, "utf-8");
      expect(result).toEqual(value);
    });

    it("should overflow to file when double-encoded envelope exceeds checkpoint limit (issue #624)", async () => {
      // The OVERFLOW_THRESHOLD is 256*1024 - 1024 = 261120 bytes.
      // We craft inlineJson that's just under this threshold but contains many
      // backslashes/quotes so that JSON.stringify({data: inlineJson}) (which
      // re-escapes them) blows past 256KB.
      //
      // Strategy: build a value whose JSON.stringify has lots of backslashes.
      // Each \ in inlineJson becomes \\ in the envelope, doubling their contribution.
      const OVERFLOW_THRESHOLD = 256 * 1024 - 1024; // 261120
      // A string of backslashes: JSON.stringify({d:"\\..."}) produces {"d":"\\\\..."}
      // So each backslash in the source string becomes 2 bytes (\\) in inlineJson.
      // Then in the envelope, each \\ becomes \\\\ (4 bytes). So ratio is 2:1 for inflation.
      // We want inlineJson ~ 255KB with ~50% being backslash escapes.
      // Let's use ~130000 backslashes -> inlineJson has ~260000 bytes of \\ sequences
      // plus ~7 bytes overhead for {"d":""}
      const numBackslashes = Math.floor((OVERFLOW_THRESHOLD - 10) / 2); // ~130555
      const value = { d: "\\".repeat(numBackslashes) };
      const inlineJson = JSON.stringify(value);
      const envelope = JSON.stringify({ data: inlineJson });

      // Verify test setup: inlineJson is under threshold but envelope exceeds 256KB
      expect(Buffer.byteLength(inlineJson, "utf-8")).toBeLessThanOrEqual(
        OVERFLOW_THRESHOLD,
      );
      expect(Buffer.byteLength(envelope, "utf-8")).toBeGreaterThan(256 * 1024);

      const result = await serdes.serialize(value, mockContext);

      // The serialized result should overflow to file, not inline
      expect(mockWriteFile).toHaveBeenCalled();
      expect(JSON.parse(result!)).toEqual({ file: EXPECTED_FILE });
    });
  });
});

describe("createFileSystemSerdes path encoding", () => {
  // An entity ID that is unsafe as a raw file name: a slash would create or
  // escape directories, and "../" would traverse outside the per-execution dir.
  const unsafeContext: SerdesContext = {
    entityId: "../invoices/2026",
    durableExecutionArn: TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
  };

  // A realistic durable execution ARN:
  // arn:aws:lambda:<region>:<account>:function:<fn>:<version>/durable-execution/<executionName>/<invocationId>
  const FUNCTION_NAME = "payment-processor";
  const EXECUTION_NAME = "045e664f-c7e6-4487-be17-30efc3c6880a";
  const INVOCATION_ID = "d6a8ddb8-0286-39d6-89bd-8f13b33d4722";
  const REALISTIC_ARN = `arn:aws:lambda:us-east-1:123456789012:function:${FUNCTION_NAME}:54/durable-execution/${EXECUTION_NAME}/${INVOCATION_ID}`;
  const realisticContext: SerdesContext = {
    entityId: TEST_CONSTANTS.STEP_ID,
    durableExecutionArn: REALISTIC_ARN,
  };

  describe("URI encoding (default)", () => {
    it("derives a compact directory from the ARN's function name, execution name and invocation id", async () => {
      const serdes = createFileSystemSerdes(BASE_PATH);
      const result = await serdes.serialize({ id: 1 }, realisticContext);

      const expectedDir = `${BASE_PATH}/${FUNCTION_NAME}/${EXECUTION_NAME}/${INVOCATION_ID}`;
      const expectedFile = `${expectedDir}/${TEST_CONSTANTS.STEP_ID}.json`;

      expect(mockMkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedFile,
        JSON.stringify({ id: 1 }),
        "utf-8",
      );
      // The whole ARN must NOT appear as a single encoded directory segment.
      expect(expectedDir).not.toContain("%3A");
      expect(JSON.parse(result!)).toEqual({ file: expectedFile });
    });

    it("falls back to encoding the whole ARN when it is not a durable-execution ARN", async () => {
      const serdes = createFileSystemSerdes(BASE_PATH);
      await serdes.serialize({ id: 1 }, mockContext);

      // TEST ARN is not in the expected shape, so the whole ARN is encoded into
      // a single directory segment (legacy layout) and the file name is unchanged.
      expect(mockMkdir).toHaveBeenCalledWith(EXPECTED_DIR, { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        EXPECTED_FILE,
        JSON.stringify({ id: 1 }),
        "utf-8",
      );
    });

    it("encodes the entityId so an unsafe name stays a single flat file", async () => {
      const serdes = createFileSystemSerdes(BASE_PATH);
      const result = await serdes.serialize({ id: 1 }, unsafeContext);

      const expectedFile = `${EXPECTED_DIR}/${encodeURIComponent(
        unsafeContext.entityId,
      )}.json`;

      // The written path must be the flat encoded file directly under the
      // ARN directory — no extra directories, no traversal.
      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedFile,
        JSON.stringify({ id: 1 }),
        "utf-8",
      );
      expect(expectedFile.startsWith(`${EXPECTED_DIR}/`)).toBe(true);
      expect(expectedFile).not.toContain("/../");
      expect(JSON.parse(result!)).toEqual({ file: expectedFile });
    });

    it("matches the legacy raw layout for IDs that need no encoding", async () => {
      const serdes = createFileSystemSerdes(BASE_PATH);
      await serdes.serialize({ id: 1 }, mockContext);

      // STEP_ID has no special chars, so encodeURIComponent is a no-op and the
      // on-disk path is unchanged from the pre-fix behavior.
      expect(mockWriteFile).toHaveBeenCalledWith(
        EXPECTED_FILE,
        JSON.stringify({ id: 1 }),
        "utf-8",
      );
    });
  });

  describe("HASH encoding", () => {
    const serdes = createFileSystemSerdes(BASE_PATH, {
      pathEncoding: FileSystemPathEncoding.HASH,
    });

    const sha256 = (v: string): string =>
      createHash("sha256").update(v).digest("hex");

    it("hashes the whole ARN directory and the entityId file name", async () => {
      const result = await serdes.serialize({ id: 1 }, realisticContext);

      const expectedDir = `${BASE_PATH}/${sha256(REALISTIC_ARN)}`;
      const expectedFile = `${expectedDir}/${sha256(
        TEST_CONSTANTS.STEP_ID,
      )}.json`;

      expect(mockMkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedFile,
        JSON.stringify({ id: 1 }),
        "utf-8",
      );
      expect(JSON.parse(result!)).toEqual({ file: expectedFile });
    });

    it("produces fixed-length (64 hex char) segment names", async () => {
      await serdes.serialize(
        { id: 1 },
        {
          entityId: "x".repeat(10_000),
          durableExecutionArn: REALISTIC_ARN,
        },
      );

      const writtenPath = mockWriteFile.mock.calls[0][0] as string;
      const fileName = writtenPath.split("/").pop()!;
      expect(fileName).toBe(`${sha256("x".repeat(10_000))}.json`);
      expect(fileName.length).toBe(64 + ".json".length);
    });
  });
});

describe("buildPreview", () => {
  const value = {
    id: "123",
    email: "alice@example.com",
    ssn: "000-00-0000",
    user: { name: "Alice", role: "admin" },
  };

  it("INCLUDE_ALL: includes all fields by default", () => {
    const result = buildPreview(value, { mode: PreviewMode.INCLUDE_ALL });
    expect(result).toHaveProperty("id", "123");
    expect(result).toHaveProperty("email", "alice@example.com");
    expect(result).toHaveProperty("ssn", "000-00-0000");
  });

  it("INCLUDE_ALL + exclude: omits excluded fields", () => {
    const result = buildPreview(value, {
      mode: PreviewMode.INCLUDE_ALL,
      exclude: [{ name: "ssn" }],
    });
    expect(result).not.toHaveProperty("ssn");
    expect(result).toHaveProperty("id", "123");
  });

  it("EXCLUDE_ALL + include: only includes specified fields", () => {
    const result = buildPreview(value, {
      mode: PreviewMode.EXCLUDE_ALL,
      include: [{ name: "id" }, { name: "email" }],
    });
    expect(result).toHaveProperty("id", "123");
    expect(result).toHaveProperty("email", "alice@example.com");
    expect(result).not.toHaveProperty("ssn");
  });

  it("mask: replaces visible field value with maskString", () => {
    const result = buildPreview(value, {
      mode: PreviewMode.INCLUDE_ALL,
      mask: [{ name: "ssn" }],
    });
    expect(result).toHaveProperty("ssn", "***");
    expect(result).toHaveProperty("id", "123");
  });

  it("mask: applies to fields nested inside arrays", () => {
    const result = buildPreview(
      { items: [{ secret: "xyz" }, { secret: "abc" }] },
      {
        mode: PreviewMode.INCLUDE_ALL,
        mask: [{ name: "secret" }],
      },
    );
    // Array structure is not preserved in preview — fields from array elements
    // are merged into a plain object at the array's path
    expect((result?.["items"] as any)?.secret).toBe("***");
  });

  it("mask: uses custom maskString", () => {
    const result = buildPreview(value, {
      mode: PreviewMode.INCLUDE_ALL,
      mask: [{ name: "ssn" }],
      maskString: "[REDACTED]",
    });
    expect(result).toHaveProperty("ssn", "[REDACTED]");
  });

  it("PATH match: only matches exact path", () => {
    const result = buildPreview(
      { email: "root@example.com", user: { email: "nested@example.com" } },
      {
        mode: PreviewMode.EXCLUDE_ALL,
        include: [{ name: "email", match: FieldMatchMode.PATH }],
      },
    );
    expect(result).toHaveProperty("email", "root@example.com");
    expect(result).not.toHaveProperty("user.email");
  });

  it("ANYWHERE match: matches field at any depth", () => {
    const result = buildPreview(
      { email: "root@example.com", user: { email: "nested@example.com" } },
      {
        mode: PreviewMode.EXCLUDE_ALL,
        include: [{ name: "email" }],
      },
    );
    expect(result?.["email"]).toBe("root@example.com");
    expect((result?.["user"] as any)?.["email"]).toBe("nested@example.com");
  });

  it("respects maxPreviewBytes budget", () => {
    const result = buildPreview(value, {
      mode: PreviewMode.INCLUDE_ALL,
      maxPreviewBytes: 20, // very small — only first field fits
    });
    expect(Object.keys(result ?? {}).length).toBeLessThan(
      Object.keys(value).length,
    );
  });

  it("returns undefined for non-object values", () => {
    expect(
      buildPreview("string", { mode: PreviewMode.INCLUDE_ALL }),
    ).toBeUndefined();
    expect(buildPreview(42, { mode: PreviewMode.INCLUDE_ALL })).toBeUndefined();
  });

  it("mask implies visibility in EXCLUDE_ALL — masked field shown even without include", () => {
    const result = buildPreview(value, {
      mode: PreviewMode.EXCLUDE_ALL,
      mask: [{ name: "ssn" }], // not in include, but mask implies visible
    });
    expect(result).toHaveProperty("ssn", "***");
    expect(result).not.toHaveProperty("id");
  });

  it("exclude wins over mask — excluded field is not shown even if in mask", () => {
    const result = buildPreview(value, {
      mode: PreviewMode.INCLUDE_ALL,
      exclude: [{ name: "ssn" }],
      mask: [{ name: "ssn" }],
    });
    expect(result).not.toHaveProperty("ssn");
  });

  it("returns undefined when no fields are visible", () => {
    const result = buildPreview(value, {
      mode: PreviewMode.EXCLUDE_ALL,
      // no include, no mask
    });
    expect(result).toBeUndefined();
  });
});

describe("createFileSystemSerdes with preview", () => {
  it("stores preview in envelope alongside file pointer", async () => {
    const serdes = createFileSystemSerdes(BASE_PATH, {
      generatePreview: (value) =>
        buildPreview(value, {
          mode: PreviewMode.EXCLUDE_ALL,
          include: [{ name: "id" }],
          mask: [{ name: "secret" }],
        }),
    });

    const value = { id: "abc", secret: "s3cr3t", other: "ignored" };
    const result = await serdes.serialize(value, mockContext);
    const envelope = JSON.parse(result!);

    expect(envelope).toHaveProperty("file");
    expect(envelope.preview).toEqual({ id: "abc", secret: "***" });
  });

  it("deserialize ignores preview field and reads from file", async () => {
    const value = { id: "abc" };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(value) as never);

    const envelope = JSON.stringify({
      file: EXPECTED_FILE,
      preview: { id: "abc" },
    });
    const result = await createFileSystemSerdes(BASE_PATH).deserialize(
      envelope,
      mockContext,
    );

    expect(result).toEqual(value);
    expect(mockReadFile).toHaveBeenCalledWith(EXPECTED_FILE, "utf-8");
  });

  it("OVERFLOW mode: includes preview when payload overflows to file", async () => {
    const serdes = createFileSystemSerdes(BASE_PATH, {
      storageMode: FileSystemSerdesMode.OVERFLOW,
      generatePreview: (value) =>
        buildPreview(value, {
          mode: PreviewMode.EXCLUDE_ALL,
          include: [{ name: "id" }],
        }),
    });

    const value = { id: "abc", data: "x".repeat(256 * 1024) };
    const result = await serdes.serialize(value, mockContext);
    const envelope = JSON.parse(result!);

    expect(envelope).toHaveProperty("file");
    expect(envelope.preview).toEqual({ id: "abc" });
  });

  it("OVERFLOW mode: no preview for inline payloads", async () => {
    const serdes = createFileSystemSerdes(BASE_PATH, {
      storageMode: FileSystemSerdesMode.OVERFLOW,
      generatePreview: (value) =>
        buildPreview(value, { mode: PreviewMode.INCLUDE_ALL }),
    });

    const value = { id: "abc" }; // small — stays inline
    const result = await serdes.serialize(value, mockContext);
    const envelope = JSON.parse(result!);

    expect(envelope).toHaveProperty("data");
    expect(envelope).not.toHaveProperty("preview");
  });
});
