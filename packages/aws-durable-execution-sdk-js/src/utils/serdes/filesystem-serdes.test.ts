import { SerdesContext } from "./serdes";
import {
  createFileSystemSerdes,
  FileSystemSerdesMode,
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
      mode: FileSystemSerdesMode.OVERFLOW,
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
