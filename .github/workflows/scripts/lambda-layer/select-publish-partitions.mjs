#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PARTITIONS = [
  {
    partition: "aws",
    credentials_region: "us-east-1",
  },
  {
    partition: "aws-cn",
    credentials_region: "cn-north-1",
  },
  {
    partition: "aws-us-gov",
    credentials_region: "us-gov-west-1",
  },
];

function partitionForRegion(region) {
  if (region.startsWith("cn-")) {
    return "aws-cn";
  }
  if (region.startsWith("us-gov-")) {
    return "aws-us-gov";
  }
  return "aws";
}

export function createPublishMatrix(regionList) {
  const regions = regionList
    .split(",")
    .map((region) => region.trim())
    .filter(Boolean);

  if (regions.length === 0) {
    throw new Error("No AWS regions were configured for layer publishing.");
  }

  const include = PARTITIONS.flatMap((partition) => {
    const partitionRegions = regions.filter(
      (region) => partitionForRegion(region) === partition.partition,
    );
    if (partitionRegions.length === 0) {
      return [];
    }

    return [
      {
        ...partition,
        regions: partitionRegions.join(","),
      },
    ];
  });

  return { include };
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const regionList = process.argv[2];
  if (regionList == null || process.argv.length !== 3) {
    console.error(
      "Usage: select-publish-partitions.mjs <comma-separated-regions>",
    );
    process.exit(2);
  }

  try {
    process.stdout.write(JSON.stringify(createPublishMatrix(regionList)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
