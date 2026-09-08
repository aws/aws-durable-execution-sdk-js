import assert from "node:assert/strict";
import test from "node:test";
import { createPublishMatrix } from "./select-publish-partitions.mjs";

test("groups regions by AWS partition", () => {
  assert.deepEqual(
    createPublishMatrix(
      "us-east-1, cn-north-1, us-gov-west-1, eu-west-1, " +
        "cn-northwest-1, us-gov-east-1",
    ),
    {
      include: [
        {
          partition: "aws",
          credentials_region: "us-east-1",
          regions: "us-east-1,eu-west-1",
        },
        {
          partition: "aws-cn",
          credentials_region: "cn-north-1",
          regions: "cn-north-1,cn-northwest-1",
        },
        {
          partition: "aws-us-gov",
          credentials_region: "us-gov-west-1",
          regions: "us-gov-west-1,us-gov-east-1",
        },
      ],
    },
  );
});

test("omits partitions without configured regions", () => {
  assert.deepEqual(createPublishMatrix(" us-west-2, , ap-south-1 "), {
    include: [
      {
        partition: "aws",
        credentials_region: "us-east-1",
        regions: "us-west-2,ap-south-1",
      },
    ],
  });
});

test("rejects an empty region list", () => {
  assert.throws(
    () => createPublishMatrix(" , "),
    /No AWS regions were configured/,
  );
});
