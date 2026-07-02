import {
  TimestreamWriteClient,
  WriteRecordsCommand,
  type Dimension,
  type _Record,
  MeasureValueType,
} from "@aws-sdk/client-timestream-write";
import type { InsightExporter, WorkflowInsightRecord } from "../types";

/**
 * Configuration for the Timestream exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface TimestreamExporterConfig {
  /** Timestream database name. */
  databaseName: string;

  /** Timestream table name. */
  tableName: string;

  /** AWS region. If omitted, uses the SDK default. */
  region?: string;
}

/**
 * Exports workflow insight records to Amazon Timestream.
 *
 * Each record is written as a multi-measure record with:
 * - Dimensions: executionArn, functionName, status, region, accountId
 * - Measures: durationMs (BIGINT), operationCount (BIGINT), recordJson (VARCHAR)
 * - Time: emittedAt timestamp
 *
 * Timestream's time-series model enables efficient queries like "p99 duration
 * over the last hour" or "failure rate trend by function" without scanning
 * full records.
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class TimestreamExporter implements InsightExporter {
  private readonly databaseName: string;
  private readonly tableName: string;
  private readonly client: TimestreamWriteClient;

  constructor(config: TimestreamExporterConfig) {
    this.databaseName = config.databaseName;
    this.tableName = config.tableName;
    this.client = new TimestreamWriteClient(
      config.region ? { region: config.region } : {},
    );
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    const dimensions: Dimension[] = [
      { Name: "executionArn", Value: record.executionArn },
      { Name: "functionName", Value: record.functionName },
      { Name: "status", Value: record.status },
      { Name: "region", Value: record.region },
      { Name: "accountId", Value: record.accountId },
    ];

    if (record.executionName) {
      dimensions.push({ Name: "executionName", Value: record.executionName });
    }

    const tsRecord: _Record = {
      Dimensions: dimensions,
      MeasureName: "insight",
      MeasureValueType: MeasureValueType.MULTI,
      MeasureValues: [
        {
          Name: "durationMs",
          Value: String(record.durationMs ?? 0),
          Type: MeasureValueType.BIGINT,
        },
        {
          Name: "operationCount",
          Value: String(record.operations.length),
          Type: MeasureValueType.BIGINT,
        },
        {
          Name: "recordJson",
          Value: JSON.stringify(record),
          Type: MeasureValueType.VARCHAR,
        },
      ],
      Time: String(new Date(record.emittedAt).getTime()),
      TimeUnit: "MILLISECONDS",
    };

    await this.client.send(
      new WriteRecordsCommand({
        DatabaseName: this.databaseName,
        TableName: this.tableName,
        Records: [tsRecord],
      }),
    );
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single WriteRecords call.
  }
}
