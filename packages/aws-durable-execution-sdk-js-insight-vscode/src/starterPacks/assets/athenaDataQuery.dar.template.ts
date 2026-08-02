/**
 * `.dar` workflow for the "AthenaDataQuery" Step Functions starter pack.
 * Hand-authored (not machine-imported) following the same convention as
 * `jobStatusPoller.dar.template.ts` (most similar prior pack - also a
 * Submit-then-poll `waitForCondition` loop) - see
 * `helloLambda.dar.template.ts`'s header for the general "why hand-author,
 * not import" rationale.
 *
 * Structure (mirrors the ASL's 8 states, collapsed to 6 `.dar` nodes):
 *   start -> Generate_Example_Log (step: invokes the data-generation Lambda
 *            once, matching the ASL's "Generate example log" state - no
 *            payload needed, matching the ASL's own empty `Output: {}`)
 *         -> Start_Glue_Crawler (step: calls Glue's StartCrawler once,
 *            matching the ASL's own separate "Run Glue crawler" state
 *            boundary)
 *         -> Poll_Glue_Crawler (waitForCondition: collapses the ASL's
 *            "Get Crawler Status" -> "Check Crawler Status" -> loop-back-via
 *            -"Wait For Crawler To Complete" cycle into ONE node, the exact
 *            JobStatusPoller pattern - see that pack's header for why a loop
 *            of `.dar` nodes is not representable at all (`emitChain`'s
 *            `visited` set silently drops revisited nodes) and must instead
 *            become a single polling primitive. `Start_Glue_Crawler` is kept
 *            as its own PRECEDING `step`, not folded into this node's `code`
 *            callback, for the identical reason JobStatusPoller keeps
 *            `Submit_Job` separate from `Poll_Job_Status`: starting the
 *            crawler must happen exactly once, but a waitForCondition's
 *            callback re-runs on every poll attempt - folding the start call
 *            in would re-trigger `StartCrawler` on every single poll
 *            iteration (which would in fact fail outright, since Glue
 *            rejects `StartCrawler` while a crawler is already RUNNING).
 *            `wait` mirrors the ASL's own `Wait For Crawler To Complete`
 *            (`Seconds: 30`) via `initialDelaySeconds: 30`, linear/no
 *            backoff, `maxAttempts: 30` (15 minutes of polling headroom for
 *            a crawl of one small CSV file, which the header comment on this
 *            file's paired `.cfn.yaml.ts` notes typically finishes in 1-3
 *            minutes)
 *         -> Start_Athena_Query (step: calls Athena's StartQueryExecution
 *            once, matching the ASL's "Start an Athena query" state MINUS
 *            its `.sync` suffix - Step Functions' own synchronous-wait
 *            variant of the async start-query API is itself a poll-until-
 *            done pattern under the hood (Athena queries are asynchronous:
 *            start one, then poll GetQueryExecution until the state is
 *            terminal), so it is split the same way as the crawler: a
 *            preceding `step` that starts the query once, followed by its
 *            own independent `waitForCondition` poll loop - matching the
 *            ASL's OWN state boundary between crawler-polling and
 *            query-polling, both being independent poll loops under a
 *            single `.sync`-suffixed Task in the original)
 *         -> Poll_Athena_Query (waitForCondition: polls GetQueryExecution
 *            until `state.status` is SUCCEEDED/FAILED/CANCELLED. Faster
 *            polling than the crawler loop - a 1-row LIMIT query against a
 *            single small CSV typically finishes in 1-3 seconds -
 *            `initialDelaySeconds: 2`, `maxAttempts: 20`)
 *         -> Get_Query_Results (step: checks Poll_Athena_Query's final
 *            `.status` - throws if not SUCCEEDED (there is no separate ASL
 *            state for this: the ASL's own `.sync` Task would have failed
 *            the whole execution on a non-successful terminal query state,
 *            so this explicit check is this workflow's replacement for that
 *            implicit behavior), otherwise calls Athena's GetQueryResults,
 *            matching the ASL's "Get query results" state)
 *         -> Send_Query_Results (step, terminal: true: publishes the query
 *            results to SNS via PublishCommand, `Message` shaped as
 *            `{ Input: <rows> }` to match the ASL's own "Send query results"
 *            `Message.Input` shape exactly)
 *
 * `dependencyMode: "linear"` (no branching anywhere - both polling loops are
 * single nodes, not `condition`/fan-out nodes, unlike JobStatusPoller's
 * `Job_Complete` condition node).
 *
 * REAL PERMISSION GAP FOUND during this pack's actual AWS verification, NOT
 * caught by validateDarJson's dry-run and NOT something `deployWorkflow()`'s
 * auto-inference can catch either - documented here so it's understood, not
 * silently worked around: this workflow's step code only calls
 * `glue:StartCrawler`/`GetCrawler` and `athena:StartQueryExecution`/
 * `GetQueryExecution`/`GetQueryResults` directly, so those 5 actions are the
 * only ones auto-inferred and attached to the deployed Lambda's role.
 * Athena itself, however, needs to read/write the S3 result bucket and read
 * the Glue Data Catalog's table/partition metadata INTERNALLY to actually
 * execute a query - permissions our step code never calls an SDK action
 * for directly, so auto-inference (which scans SDK call sites) cannot see
 * them at all. Real execution failed on the very first attempt with
 * "Unable to verify/create output bucket ..." until an EXTRA, hand-written
 * IAM policy was attached granting `s3:GetBucketLocation`/`GetObject`/
 * `ListBucket`/`ListBucketMultipartUploads`/`ListMultipartUploadParts`/
 * `AbortMultipartUpload`/`PutObject` on `arn:aws:s3:::*` and
 * `glue:GetDatabase`/`GetTable`/`GetTables`/`GetPartitions`/`GetPartition`/
 * `BatchGetPartition` on the account's Glue catalog/database/table ARNs -
 * mirroring the ORIGINAL `AthenaWorkflowExecutionRole`'s own S3/Glue policy
 * statements exactly (see `athenaDataQuery.cfn.yaml.ts` - that role's
 * policy is the authoritative reference for what Athena needs beyond the
 * directly-called actions). A production deployment of this pack must
 * attach that extra policy explicitly (e.g. via `deployWorkflow()`'s
 * `roleArn` option pointing at a hand-authored role, or a follow-up
 * `put-role-policy` after deploy) - auto-inference alone is NOT sufficient
 * for this pack, unlike every simpler pack in this repo so far.
 *
 * TEARDOWN NOTE, also found during real verification: an `AWS::Athena::WorkGroup`
 * cannot be deleted by CloudFormation while it has ANY associated query
 * execution history (`"WorkGroup ... is not empty"`) - CFN's own resource
 * type exposes no "force/recursive delete" property, so a real teardown
 * must first call Athena's own `DeleteWorkGroup` API directly with
 * `RecursiveDeleteOption: true` before retrying `delete-stack`. Likewise,
 * `LogBucket` (versioned) cannot be deleted by CFN while it still holds any
 * object versions (the crawled CSV, plus Athena's own query-result files
 * written to the bucket) - these must be emptied via `list-object-versions`
 * + `delete-objects` before retrying. Both are real AWS platform
 * constraints, not bugs in this vendored template.
 *
 * Every embedded code string below uses string concatenation (`"a" + b +
 * "c"`) instead of template literals for anything that needs to reference a
 * value at generated-handler runtime (most notably `Start_Athena_Query`'s
 * `QueryString`, which itself contains literal double-quotes around the
 * database/table names) - the established lesson from HelloLambda's real
 * verification run (nested template-literal / quote escaping inside this
 * outer `.dar.template.ts` template literal is a reliable source of subtle
 * corruption).
 *
 * Lambda invoke responses are decoded with a plain `JSON.parse(response.Payload)`
 * - `generateHandler.ts`'s `fixLambdaPayloadDecoding` rewrites that pattern to
 * decode the underlying `Uint8Array` via `TextDecoder` automatically, so
 * hand-written code must NOT add its own `TextDecoder` call (that would no
 * longer match the rewrite's regex and would double-decode). `Generate_Example_Log`
 * does not need its Lambda's payload at all (the ASL's own "Generate example
 * log" state discards the invoke's result via `"Output": {}`), so its step
 * code does not parse the response.
 */

const DAR_TEMPLATE = `{
  "darVersion": "1.0",
  "name": "AthenaDataQuery",
  "dependencyMode": "linear",
  "nodes": [
    {
      "id": "start",
      "kind": "start",
      "name": "Start",
      "position": { "x": 40, "y": 0 }
    },
    {
      "id": "Generate_Example_Log",
      "name": "Generate Example Log",
      "position": { "x": 40, "y": 150 },
      "kind": "step",
      "code": "const { LambdaClient, InvokeCommand } = require(\\"@aws-sdk/client-lambda\\");\\n\\nconst lambdaClient = new LambdaClient({ region: \\"{{REGION}}\\" });\\n\\nawait lambdaClient.send(\\n  new InvokeCommand({\\n    FunctionName: \\"{{DATA_GENERATION_LAMBDA_ARN}}\\",\\n  }),\\n);\\n\\nreturn {};"
    },
    {
      "id": "Start_Glue_Crawler",
      "name": "Start Glue Crawler",
      "position": { "x": 40, "y": 300 },
      "kind": "step",
      "code": "const { GlueClient, StartCrawlerCommand } = require(\\"@aws-sdk/client-glue\\");\\n\\nconst glueClient = new GlueClient({ region: \\"{{REGION}}\\" });\\n\\nawait glueClient.send(\\n  new StartCrawlerCommand({\\n    Name: \\"{{CRAWLER_NAME}}\\",\\n  }),\\n);\\n\\nreturn { status: \\"RUNNING\\" };"
    },
    {
      "id": "Poll_Glue_Crawler",
      "name": "Poll Glue Crawler",
      "position": { "x": 40, "y": 450 },
      "kind": "waitForCondition",
      "initialState": "{ \\"status\\": Start_Glue_Crawler.status }",
      "code": "const { GlueClient, GetCrawlerCommand } = require(\\"@aws-sdk/client-glue\\");\\n\\nconst glueClient = new GlueClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await glueClient.send(\\n  new GetCrawlerCommand({\\n    Name: \\"{{CRAWLER_NAME}}\\",\\n  }),\\n);\\n\\nreturn { status: response.Crawler.State };",
      "stopCondition": "state.status === 'READY'",
      "wait": {
        "kind": "linear",
        "maxAttempts": 30,
        "initialDelaySeconds": 30,
        "incrementSeconds": 0,
        "maxDelaySeconds": 30,
        "jitter": "NONE"
      }
    },
    {
      "id": "Start_Athena_Query",
      "name": "Start Athena Query",
      "position": { "x": 40, "y": 600 },
      "kind": "step",
      "code": "const { AthenaClient, StartQueryExecutionCommand } = require(\\"@aws-sdk/client-athena\\");\\n\\nconst athenaClient = new AthenaClient({ region: \\"{{REGION}}\\" });\\n\\nconst queryString = 'SELECT * FROM \\"' + \\"{{GLUE_DATABASE}}\\" + '\\".\\"log\\" limit 1';\\n\\nconst response = await athenaClient.send(\\n  new StartQueryExecutionCommand({\\n    QueryString: queryString,\\n    WorkGroup: \\"{{ATHENA_WORKGROUP}}\\",\\n  }),\\n);\\n\\nreturn { queryExecutionId: response.QueryExecutionId };"
    },
    {
      "id": "Poll_Athena_Query",
      "name": "Poll Athena Query",
      "position": { "x": 40, "y": 750 },
      "kind": "waitForCondition",
      "initialState": "{ \\"queryExecutionId\\": Start_Athena_Query.queryExecutionId, \\"status\\": \\"RUNNING\\" }",
      "code": "const { AthenaClient, GetQueryExecutionCommand } = require(\\"@aws-sdk/client-athena\\");\\n\\nconst athenaClient = new AthenaClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await athenaClient.send(\\n  new GetQueryExecutionCommand({\\n    QueryExecutionId: state.queryExecutionId,\\n  }),\\n);\\n\\nreturn { ...state, status: response.QueryExecution.Status.State };",
      "stopCondition": "state.status === 'SUCCEEDED' || state.status === 'FAILED' || state.status === 'CANCELLED'",
      "wait": {
        "kind": "linear",
        "maxAttempts": 20,
        "initialDelaySeconds": 2,
        "incrementSeconds": 0,
        "maxDelaySeconds": 2,
        "jitter": "NONE"
      }
    },
    {
      "id": "Get_Query_Results",
      "name": "Get Query Results",
      "position": { "x": 40, "y": 900 },
      "kind": "step",
      "code": "if (Poll_Athena_Query.status !== \\"SUCCEEDED\\") {\\n  throw new Error(\\"Athena query did not succeed: \\" + Poll_Athena_Query.status);\\n}\\n\\nconst { AthenaClient, GetQueryResultsCommand } = require(\\"@aws-sdk/client-athena\\");\\n\\nconst athenaClient = new AthenaClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await athenaClient.send(\\n  new GetQueryResultsCommand({\\n    QueryExecutionId: Start_Athena_Query.queryExecutionId,\\n  }),\\n);\\n\\nreturn response.ResultSet.Rows;"
    },
    {
      "id": "Send_Query_Results",
      "name": "Send Query Results",
      "position": { "x": 40, "y": 1050 },
      "kind": "step",
      "code": "const { SNSClient, PublishCommand } = require(\\"@aws-sdk/client-sns\\");\\n\\nconst snsClient = new SNSClient({ region: \\"{{REGION}}\\" });\\n\\nconst response = await snsClient.send(\\n  new PublishCommand({\\n    TopicArn: \\"{{SNS_TOPIC_ARN}}\\",\\n    Message: JSON.stringify({ Input: Get_Query_Results }),\\n  }),\\n);\\n\\nreturn response;",
      "terminal": true
    }
  ],
  "edges": [
    { "id": "e0_start_Generate_Example_Log", "source": "start", "target": "Generate_Example_Log" },
    { "id": "e1_Generate_Example_Log_Start_Glue_Crawler", "source": "Generate_Example_Log", "target": "Start_Glue_Crawler" },
    { "id": "e2_Start_Glue_Crawler_Poll_Glue_Crawler", "source": "Start_Glue_Crawler", "target": "Poll_Glue_Crawler" },
    { "id": "e3_Poll_Glue_Crawler_Start_Athena_Query", "source": "Poll_Glue_Crawler", "target": "Start_Athena_Query" },
    { "id": "e4_Start_Athena_Query_Poll_Athena_Query", "source": "Start_Athena_Query", "target": "Poll_Athena_Query" },
    { "id": "e5_Poll_Athena_Query_Get_Query_Results", "source": "Poll_Athena_Query", "target": "Get_Query_Results" },
    { "id": "e6_Get_Query_Results_Send_Query_Results", "source": "Get_Query_Results", "target": "Send_Query_Results" }
  ]
}`;

export interface AthenaDataQueryDarContext {
  region: string;
  dataGenerationLambdaArn: string;
  crawlerName: string;
  glueDatabase: string;
  athenaWorkgroup: string;
  snsTopicArn: string;
}

/** Fills in the .dar template's placeholders from a deployed CFN stack's outputs. */
export function resolveAthenaDataQueryDar(
  ctx: AthenaDataQueryDarContext,
): string {
  return DAR_TEMPLATE.replace(/\{\{REGION\}\}/g, ctx.region)
    .replace(/\{\{DATA_GENERATION_LAMBDA_ARN\}\}/g, ctx.dataGenerationLambdaArn)
    .replace(/\{\{CRAWLER_NAME\}\}/g, ctx.crawlerName)
    .replace(/\{\{GLUE_DATABASE\}\}/g, ctx.glueDatabase)
    .replace(/\{\{ATHENA_WORKGROUP\}\}/g, ctx.athenaWorkgroup)
    .replace(/\{\{SNS_TOPIC_ARN\}\}/g, ctx.snsTopicArn);
}

export default DAR_TEMPLATE;
