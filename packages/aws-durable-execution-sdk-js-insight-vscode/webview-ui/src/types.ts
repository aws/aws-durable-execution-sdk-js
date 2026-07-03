/** Messages from webview → extension host */
export type OutboundMessage =
  | { type: "ready" }
  | { type: "generate"; question: string }
  | { type: "saveSettings"; settings: Record<string, string> }
  | { type: "downloadModel" }
  | { type: "startListening" }
  | { type: "stopListening" };

/** A single SQS message, normalized for display. */
export interface SqsMessageRow {
  messageId: string;
  receivedAt: string;
  body: string;
  attributes: Record<string, string>;
}

/** Messages from extension host → webview */
export type InboundMessage =
  | { type: "config"; settings: Settings; modelDownloaded?: boolean }
  | { type: "status"; text: string }
  | {
      type: "results";
      columns: string[];
      rows: string[][];
      count: number;
      explanation?: string;
      finalQuery?: string;
      suggestedCharts?: string[];
    }
  | { type: "error"; message: string }
  | { type: "settingsSaved" }
  | { type: "downloadProgress"; percent: number; done: boolean }
  | { type: "sqsStatus"; listening: boolean }
  | { type: "sqsMessages"; messages: SqsMessageRow[] };

export interface Settings {
  region: string;
  destinationType: string;
  logGroupName: string;
  dynamodbTableName: string;
  auroraResourceArn: string;
  auroraSecretArn: string;
  auroraDatabase: string;
  auroraTable: string;
  sqsQueueUrl: string;
  sqsDeleteAfterRead: boolean;
  llmProvider: string;
  awsProfile: string;
  bedrockModelId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  region: "us-east-1",
  destinationType: "cloudwatch-logs-exporter",
  logGroupName: "",
  dynamodbTableName: "",
  auroraResourceArn: "",
  auroraSecretArn: "",
  auroraDatabase: "postgres",
  auroraTable: "workflow_insight",
  sqsQueueUrl: "",
  sqsDeleteAfterRead: false,
  llmProvider: "bedrock",
  awsProfile: "",
  bedrockModelId: "us.anthropic.claude-sonnet-4-20250514-v1:0",
};
