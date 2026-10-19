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

  // The Redshift Data API's ExecuteStatement runs a SINGLE statement, but the
  // provisioning SQL contains several (CREATE TABLE, GRANT, ...). Split on ';'
  // and run each in order, polling each to completion.
  const statements = String(sql)
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let lastStatementId = "";
  for (const statement of statements) {
    lastStatementId = await runStatement(workgroupName, database, statement);
  }

  return {
    PhysicalResourceId: `redshift-create-table-${workgroupName}-${database}`,
    Data: { status: "FINISHED", statementId: lastStatementId },
  };
}

/** Execute one SQL statement via the Redshift Data API and poll until done. */
async function runStatement(
  workgroupName: string,
  database: string,
  sql: string,
): Promise<string> {
  const executeResp = await client.send(
    new ExecuteStatementCommand({
      WorkgroupName: workgroupName,
      Database: database,
      Sql: sql,
    }),
  );

  const statementId = executeResp.Id!;
  console.log(`ExecuteStatement submitted: ${statementId}`);

  const startTime = Date.now();
  while (Date.now() - startTime < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const desc = await client.send(
      new DescribeStatementCommand({ Id: statementId }),
    );

    const status = desc.Status;
    console.log(`Statement ${statementId}: ${status}`);

    if (status === "FINISHED") {
      return statementId;
    }

    if (status === "FAILED" || status === "ABORTED") {
      throw new Error(
        `Redshift statement failed: ${desc.Error ?? "unknown error"} (statement: ${statementId})`,
      );
    }
  }

  throw new Error(
    `Redshift statement timed out after ${MAX_WAIT_MS / 1000}s (statement: ${statementId})`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
