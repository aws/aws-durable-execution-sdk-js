import type {
  CdkCustomResourceEvent,
  CdkCustomResourceResponse,
} from "aws-lambda";
import {
  RedshiftDataClient,
  ExecuteStatementCommand,
  DescribeStatementCommand,
} from "@aws-sdk/client-redshift-data";

const client = new RedshiftDataClient({});

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 120_000; // 2 minutes max

/**
 * CDK Provider-compatible custom resource that creates a Redshift table
 * and polls DescribeStatement until the SQL finishes or fails.
 *
 * Unlike the RDS Data API (synchronous), Redshift Data API is async —
 * ExecuteStatement returns immediately. This handler polls to confirm
 * the CREATE TABLE actually succeeded.
 */
export async function handler(
  event: CdkCustomResourceEvent,
): Promise<CdkCustomResourceResponse> {
  const requestType = event.RequestType;

  if (requestType === "Delete") {
    return {
      PhysicalResourceId: event.PhysicalResourceId ?? "redshift-create-table",
      Data: { status: "SKIPPED" },
    };
  }

  // Create or Update: execute the SQL and wait for completion
  const workgroupName = event.ResourceProperties.WorkgroupName;
  const database = event.ResourceProperties.Database;
  const sql = event.ResourceProperties.Sql;

  const executeResp = await client.send(
    new ExecuteStatementCommand({
      WorkgroupName: workgroupName,
      Database: database,
      Sql: sql,
    }),
  );

  const statementId = executeResp.Id!;
  console.log(`ExecuteStatement submitted: ${statementId}`);

  // Poll until finished
  const startTime = Date.now();
  while (Date.now() - startTime < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const desc = await client.send(
      new DescribeStatementCommand({ Id: statementId }),
    );

    const status = desc.Status;
    console.log(`Statement ${statementId}: ${status}`);

    if (status === "FINISHED") {
      return {
        PhysicalResourceId: `redshift-create-table-${workgroupName}-${database}`,
        Data: { status: "FINISHED", statementId },
      };
    }

    if (status === "FAILED" || status === "ABORTED") {
      throw new Error(
        `Redshift CREATE TABLE failed: ${desc.Error ?? "unknown error"} (statement: ${statementId})`,
      );
    }
  }

  throw new Error(
    `Redshift CREATE TABLE timed out after ${MAX_WAIT_MS / 1000}s (statement: ${statementId})`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
