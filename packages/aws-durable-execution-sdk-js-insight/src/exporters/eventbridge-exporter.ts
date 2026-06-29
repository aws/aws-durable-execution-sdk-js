import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import type { InsightExporter, WorkflowInsightRecord } from "../types";

/**
 * Configuration for the EventBridge exporter.
 * @experimental This interface is experimental and may change in future releases.
 */
export interface EventBridgeExporterConfig {
  /**
   * EventBridge event bus name or ARN.
   * Default: "default" (the account's default bus).
   */
  eventBusName?: string;

  /**
   * Event source string.
   * Default: "aws.durable-execution.insight"
   */
  source?: string;

  /** AWS region. If omitted, uses the SDK default. */
  region?: string;
}

/**
 * Exports workflow insight records to Amazon EventBridge via PutEvents.
 *
 * Each record is published as a single event with:
 * - Source: configurable (default "aws.durable-execution.insight")
 * - DetailType: the record status (e.g. "SUCCEEDED", "RUNNING", "FAILED")
 * - Detail: the full WorkflowInsightRecord as JSON
 *
 * Customers can create EventBridge rules to react to execution state changes
 * (trigger notifications, fan out to multiple consumers, invoke workflows).
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class EventBridgeExporter implements InsightExporter {
  private readonly eventBusName: string;
  private readonly source: string;
  private readonly client: EventBridgeClient;

  constructor(config: EventBridgeExporterConfig = {}) {
    this.eventBusName = config.eventBusName ?? "default";
    this.source = config.source ?? "aws.durable-execution.insight";
    this.client = new EventBridgeClient(
      config.region ? { region: config.region } : {},
    );
  }

  async export(record: WorkflowInsightRecord): Promise<void> {
    const result = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.eventBusName,
            Source: this.source,
            DetailType: record.status,
            Detail: JSON.stringify(record),
            Time: new Date(record.emittedAt),
          },
        ],
      }),
    );

    if (result.FailedEntryCount && result.FailedEntryCount > 0) {
      const entry = result.Entries?.[0];
      throw new Error(
        `EventBridge PutEvents failed: ${entry?.ErrorCode} — ${entry?.ErrorMessage}`,
      );
    }
  }

  async flush(): Promise<void> {
    // No buffering — each export is a single PutEvents call.
  }
}
