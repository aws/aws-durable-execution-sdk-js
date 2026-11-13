import { it, expect } from "vitest";
import * as publicApi from "./index";
import { getTruncationFormat } from "./truncation-internal";
import { CloudWatchLogsExporter } from "./exporters/cloudwatch-logs-exporter";
import { DynamoDBExporter } from "./exporters/dynamodb-exporter";
import { FileExporter } from "./exporters/file-exporter";
import { HttpExporter } from "./exporters/http-exporter";
import { OTelExporter } from "./exporters/otel-exporter";

// Truncation metadata must not become a property of exporter instances or a
// field of their exported classes: typed mocks written against the public types
// would stop compiling, and customers cannot set a symbol they cannot import.

it("does not export truncation internals from the package entry point", () => {
  const exported = Object.keys(publicApi);
  expect(exported).not.toContain("getTruncationFormat");
  expect(exported).not.toContain("registerTruncationFormat");
  expect(exported).not.toContain("truncateRecordWithOperationsFormat");
});

it("registers truncation formats without adding own properties to exporter instances", () => {
  const exporters = [
    new CloudWatchLogsExporter({ logGroupName: "group" }),
    new DynamoDBExporter({ tableName: "table" }),
    new FileExporter({ directory: "/tmp/telemetry" }),
    new HttpExporter({ url: "https://example.com/hook" }),
    new OTelExporter({ endpoint: "https://otel.example/v1/logs" }),
  ];
  for (const exporter of exporters) {
    expect(getTruncationFormat(exporter)).toBeDefined();
    expect(
      Reflect.ownKeys(exporter).filter((key) => typeof key === "symbol"),
    ).toEqual([]);
    expect(Object.keys(exporter)).not.toContain("truncationFormat");
  }
});
