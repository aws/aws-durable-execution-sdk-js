import { DescribeDBEngineVersionsCommand } from "@aws-sdk/client-rds";
import {
  assertAuroraEngineVersionAvailable,
  type EngineVersionClient,
} from "./engine-version";

/** A fake RDS client that lists `versions`, or fails with `error`. */
function fakeClient(versions: string[], error?: Error) {
  const calls: DescribeDBEngineVersionsCommand[] = [];
  const client: EngineVersionClient = {
    send: async (command) => {
      calls.push(command);
      if (error) throw error;
      return { DBEngineVersions: versions.map((v) => ({ EngineVersion: v })) };
    },
  };
  return { client, calls };
}

describe("assertAuroraEngineVersionAvailable", () => {
  it("passes when RDS lists the version, asking only for its major version", async () => {
    const { client, calls } = fakeClient(["17.4", "17.9", "17.11"]);
    await expect(
      assertAuroraEngineVersionAvailable("17.9", "us-east-1", client),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual({
      Engine: "aurora-postgresql",
      EngineVersion: "17",
    });
  });

  it("fails when RDS does not list the version, naming the plain versions it does list", async () => {
    // 16.4 is still listed as 16.4-limitless, which is a different engine
    // variant, so it must not count as 16.4.
    const { client } = fakeClient(["16.4-limitless", "16.8", "16.13"]);
    await expect(
      assertAuroraEngineVersionAvailable("16.4", "us-east-1", client),
    ).rejects.toThrow(
      'destinations.aurora.engineVersion "16.4" is not offered for aurora-postgresql in us-east-1. Available 16.x versions: 16.8, 16.13.',
    );
  });

  it("fails when RDS lists no version of that major version", async () => {
    const { client } = fakeClient([]);
    await expect(
      assertAuroraEngineVersionAvailable("99.1", "us-east-1", client),
    ).rejects.toThrow("RDS lists no 99.x versions.");
  });

  it.each(["17", "17.9.1", "v17.9", ""])(
    "rejects %p as not major.minor without calling AWS",
    async (version) => {
      const { client, calls } = fakeClient(["17.9"]);
      await expect(
        assertAuroraEngineVersionAvailable(version, "us-east-1", client),
      ).rejects.toThrow("is not in major.minor form");
      expect(calls).toHaveLength(0);
    },
  );

  it("warns and continues when RDS cannot be reached", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = fakeClient([], new Error("Could not load credentials"));
    await expect(
      assertAuroraEngineVersionAvailable("17.9", "us-east-1", client),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not load credentials"),
    );
    warn.mockRestore();
  });
});
