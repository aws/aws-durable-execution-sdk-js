import { DescribeDBEngineVersionsCommand } from "@aws-sdk/client-rds";
import {
  assertAuroraEngineVersionAvailable,
  type EngineVersionClient,
} from "./engine-version";

type Listed = {
  EngineVersion: string;
  ServerlessV2FeaturesSupport?: { MinCapacity?: number; MaxCapacity?: number };
};

/** A fake RDS client that lists `versions`, or fails with `error`. */
function fakeClient(
  versions: Listed[],
  options: { error?: Error; region?: string } = {},
) {
  const calls: DescribeDBEngineVersionsCommand[] = [];
  const client: EngineVersionClient = {
    send: async (command) => {
      calls.push(command);
      if (options.error) throw options.error;
      return { DBEngineVersions: versions };
    },
    config: { region: async () => options.region ?? "us-west-2" },
  };
  return { client, calls };
}

const serverless = (MinCapacity: number, MaxCapacity: number) => ({
  ServerlessV2FeaturesSupport: { MinCapacity, MaxCapacity },
});

const settings = (
  engineVersion: string,
  minCapacity = 0.5,
  maxCapacity = 1,
) => ({
  engineVersion,
  minCapacity,
  maxCapacity,
});

describe("assertAuroraEngineVersionAvailable", () => {
  it("passes for a listed Serverless v2 version, asking only for its major version", async () => {
    const { client, calls } = fakeClient([
      { EngineVersion: "17.4", ...serverless(0, 256) },
      { EngineVersion: "17.9", ...serverless(0, 256) },
    ]);
    await expect(
      assertAuroraEngineVersionAvailable(settings("17.9"), "us-east-1", client),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual({
      Engine: "aurora-postgresql",
      EngineVersion: "17",
    });
  });

  it("fails for an unlisted version, naming the plain versions, the deployed-stack hint, and the opt-out", async () => {
    // 16.4 is still listed as 16.4-limitless, which is a different engine
    // variant, so it must not count as 16.4.
    const { client } = fakeClient([
      { EngineVersion: "16.4-limitless" },
      { EngineVersion: "16.8", ...serverless(0.5, 128) },
      { EngineVersion: "16.13", ...serverless(0, 256) },
    ]);
    const check = assertAuroraEngineVersionAvailable(
      settings("16.4"),
      "us-east-1",
      client,
    );
    await expect(check).rejects.toThrow(
      'destinations.aurora.engineVersion "16.4" is not offered for aurora-postgresql in us-east-1. Available 16.x versions: 16.8, 16.13.',
    );
    await expect(check).rejects.toThrow("use the cluster's current version");
    await expect(check).rejects.toThrow("-c skipEngineVersionCheck=true");
  });

  it("fails when RDS lists no version of that major version", async () => {
    const { client } = fakeClient([]);
    await expect(
      assertAuroraEngineVersionAvailable(settings("99.1"), "us-east-1", client),
    ).rejects.toThrow("RDS lists no 99.x versions.");
  });

  it("fails for a listed version without Serverless v2 support", async () => {
    // RDS lists 12.22 in us-east-1 with no ServerlessV2FeaturesSupport.
    const { client } = fakeClient([{ EngineVersion: "12.22" }]);
    await expect(
      assertAuroraEngineVersionAvailable(
        settings("12.22"),
        "us-east-1",
        client,
      ),
    ).rejects.toThrow(
      '"12.22" does not support Aurora Serverless v2 in us-east-1',
    );
  });

  it.each([
    ["minCapacity below the version's minimum", 0, 1],
    ["maxCapacity above the version's maximum", 0.5, 256],
  ])("fails when %s", async (_case, minCapacity, maxCapacity) => {
    const { client } = fakeClient([
      { EngineVersion: "13.9", ...serverless(0.5, 128) },
    ]);
    await expect(
      assertAuroraEngineVersionAvailable(
        settings("13.9", minCapacity, maxCapacity),
        "us-east-1",
        client,
      ),
    ).rejects.toThrow(
      "outside the Serverless v2 range for aurora-postgresql 13.9 in us-east-1 (0.5 to 128 ACUs)",
    );
  });

  it("names the region the client resolved when none was passed", async () => {
    const { client } = fakeClient([], { region: "eu-west-1" });
    await expect(
      assertAuroraEngineVersionAvailable(settings("16.4"), undefined, client),
    ).rejects.toThrow("in eu-west-1.");
  });

  it.each(["17", "17.9.1", "v17.9", ""])(
    "rejects %p as not major.minor without calling AWS",
    async (version) => {
      const { client, calls } = fakeClient([{ EngineVersion: "17.9" }]);
      await expect(
        assertAuroraEngineVersionAvailable(
          settings(version),
          "us-east-1",
          client,
        ),
      ).rejects.toThrow("is not in major.minor form");
      expect(calls).toHaveLength(0);
    },
  );

  describe("when the RDS call fails", () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    it("warns and continues when RDS cannot be reached", async () => {
      const { client } = fakeClient([], {
        error: new Error("Could not load credentials"),
      });
      await expect(
        assertAuroraEngineVersionAvailable(
          settings("17.9"),
          "us-east-1",
          client,
        ),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Could not load credentials"),
      );
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining("rds:DescribeDBEngineVersions"),
      );
    });

    it("names the permission when RDS rejects the call", async () => {
      const denied = Object.assign(new Error("User is not authorized"), {
        $metadata: { httpStatusCode: 403 },
      });
      const { client } = fakeClient([], { error: denied });
      await expect(
        assertAuroraEngineVersionAvailable(
          settings("17.9"),
          "us-east-1",
          client,
        ),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "needs valid credentials with the rds:DescribeDBEngineVersions permission",
        ),
      );
    });
  });
});
