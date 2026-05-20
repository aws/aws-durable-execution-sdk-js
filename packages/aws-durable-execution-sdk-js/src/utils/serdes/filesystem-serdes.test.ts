import { SerdesContext } from "./serdes";
import {
  createFileSystemSerdes,
  FileSystemSerdesMode,
  PreviewMode,
  FieldMatchMode,
  buildPreview,
} from "./filesystem-serdes";
import { TEST_CONSTANTS } from "../../testing/test-constants";

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
