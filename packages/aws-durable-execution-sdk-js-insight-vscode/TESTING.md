# Testing the Workflow Insight Explorer Extension

This guide walks you through setting up and testing the extension against real
Workflow Insight data in CloudWatch Logs.

## Prerequisites

- VS Code ≥ 1.90
- Node.js ≥ 20
- AWS credentials with access to:
  - `logs:StartQuery`, `logs:GetQueryResults` on the target log group
  - `bedrock:InvokeModel` on the chosen model/inference profile
- A durable function emitting Workflow Insight records (the demo function
  `insight-demo-scheduled` in account `730758745077` / `us-east-1` is already
  running and generating data every minute)

## 1. Get AWS credentials

```bash
ada credentials update --once --account=730758745077 --role=Admin
```

This writes to `~/.aws/credentials` under the `default` profile. The extension
reads credentials via the standard AWS provider chain, so no additional
configuration is needed.

## 2. Open the extension in VS Code

```bash
cd packages/aws-durable-execution-sdk-js-insight-vscode
code .
```

> If `code` is not found, open VS Code manually → ⌘⇧P → **Shell Command:
> Install 'code' command in PATH**. Or use **File → Open Folder** and navigate
> to `packages/aws-durable-execution-sdk-js-insight-vscode`.

## 3. Install dependencies and build

```bash
npm install
npm run build
```

## 4. Create launch configuration and settings

Create `.vscode/launch.json` (tells VS Code how to run the extension in dev mode):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}",
        "${workspaceFolder}"
      ]
    }
  ]
}
```

> The second `"${workspaceFolder}"` argument tells the Extension Development Host
> to open this folder as its workspace, so it picks up `.vscode/settings.json`.

Create `.vscode/settings.json` (configures the extension with your AWS details):

```json
{
  "workflowInsight.region": "us-east-1",
  "workflowInsight.logGroupName": "/aws/lambda/insight-demo-scheduled",
  "workflowInsight.bedrockModelId": "us.anthropic.claude-sonnet-4-20250514-v1:0"
}
```

| Setting          | Description                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| `region`         | AWS region of the log group                                                  |
| `logGroupName`   | CloudWatch log group receiving insight records. Comma-separate for multiple. |
| `awsProfile`     | Named AWS profile (leave empty to use default from `ada`/env)                |
| `bedrockModelId` | Bedrock model or inference profile id for NL→query conversion                |

> These files go in the extension's own folder. The Extension Development Host
> (next step) picks them up automatically because it inherits the workspace
> configuration.

## 5. Launch the Extension Development Host

Press **F5** (or Run → Start Debugging). This opens a **second VS Code window**
with your extension loaded. The extension is NOT installed globally — it only
runs in this sandboxed window.

## 6. Open the Explorer

In the Extension Development Host window:

1. Open the Command Palette: **⌘⇧P** (macOS) / **Ctrl+Shift+P** (Windows/Linux)
2. Type: **Workflow Insight: Open Explorer**
3. Press Enter

The webview panel opens showing:

- A config line: `us-east-1 · /aws/lambda/insight-demo-scheduled`
- A plain-English query box
- A time-range selector (default: "Last 24 hours")
- An editable generated-query area
- A results table (initially empty)

## 7. Ask a question

Type one of these in the query box and click **Generate query**:

| Question                                     | What it tests                |
| -------------------------------------------- | ---------------------------- |
| `count executions by status`                 | Aggregation (stats)          |
| `show the most recent failed executions`     | Filtering + field extraction |
| `average duration of successful executions`  | Numeric aggregation          |
| `executions that took longer than 5 seconds` | Numeric comparison           |
| `failures with a timeout error`              | Multi-condition filter       |

The extension calls Bedrock, which returns a Logs Insights query and a
one-sentence explanation. The generated query appears in the editable text area.

## 8. Run the query

Review (and optionally edit) the generated query, then click **Run**.

Results render in a table below. The demo function produces ~900+ records per
day, so you should see data immediately with "Last 24 hours" selected.

### Expected results

| Query           | Expected output                                                  |
| --------------- | ---------------------------------------------------------------- |
| count by status | SUCCEEDED (~120+), RUNNING (~600+), PENDING (~160+)              |
| recent failures | Rows with error "Payment gateway timed out" (25% failure rate)   |
| avg duration    | ~5300ms for SUCCEEDED (dominated by the 5-second `context.wait`) |

## Troubleshooting

| Symptom                              | Fix                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| "The model did not return a query"   | Credentials expired — re-run `ada credentials update --once ...`                                  |
| "No log group configured"            | Check `logGroupName` is exactly `/aws/lambda/insight-demo-scheduled`                              |
| ResourceNotFoundException on Bedrock | Use the inference profile id: `us.anthropic.claude-sonnet-4-20250514-v1:0` (not the raw model id) |
| Empty results                        | Widen the time range, or check credentials have `logs:StartQuery` permission                      |
| Timeout polling for results          | Simplify the query or widen the time range (fewer records = faster)                               |

## How it works (under the hood)

```
English question ──► Bedrock (Converse API, forced tool call)
                           │
                           ▼
              CloudWatch Logs Insights query
              (shown for review/edit)
                           │
                           ▼
              StartQuery → poll GetQueryResults
                           │
                           ▼
                     results table
```

The system prompt gives Bedrock:

1. The exact `WorkflowInsightRecord` schema
2. The CloudWatch Logs Insights dialect (including the `parse message ...` pattern
   needed because Lambda's JSON log format nests records inside a `message` field)
3. Five worked examples

The extension injects a `| limit` clause when absent and shows the query for
review before execution. Logs Insights is read-only by design.

## About the demo function

The scheduled durable function (`insight-demo-scheduled`) runs a small
order-processing workflow every minute:

1. `validate-order` — generates a random order
2. `check-inventory` — marks in-stock
3. `cool-down` — 5-second `context.wait` (exercises suspend/replay)
4. `charge-payment` — 25% random failure rate (produces FAILED records)
5. `send-receipt` — final step

It uses `emitMode: "in-progress"` so records are emitted on every operation
change (RUNNING snapshots) plus at the end (SUCCEEDED/FAILED/PENDING terminal
snapshots). This produces rich, varied data for testing queries.

**Resources** (account 730758745077, us-east-1):

- Lambda: `insight-demo-scheduled` (alias `live` → version 2)
- EventBridge rule: `insight-demo-every-minute` → `rate(1 minute)`
- Log group: `/aws/lambda/insight-demo-scheduled`
