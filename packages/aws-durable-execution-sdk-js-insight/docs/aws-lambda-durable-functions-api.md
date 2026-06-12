# AWS Lambda Durable Functions API

## ListDurableExecutionsByFunction

**Endpoint:** `GET /2025-12-01/functions/{FunctionName}/durable-executions`

### Parameters

| Parameter              | Type  | Description                          |
| ---------------------- | ----- | ------------------------------------ |
| `FunctionName`         | Path  | Lambda function name (required)      |
| `DurableExecutionName` | Query | Filter by specific execution name    |
| `Statuses`             | Query | Comma-separated status list          |
| `StartedAfter`         | Query | ISO8601 timestamp filter (inclusive) |
| `StartedBefore`        | Query | ISO8601 timestamp filter (inclusive) |
| `Qualifier`            | Query | Function version or alias            |
| `MaxItems`             | Query | Result limit (1-1000, default 50)    |
| `Marker`               | Query | Pagination token                     |
| `ReverseOrder`         | Query | Boolean for descending order         |

### Status Values

- `RUNNING` - Execution in progress
- `SUCCEEDED` - Completed successfully
- `FAILED` - Failed with error
- `TIMED_OUT` - Exceeded timeout limit
- `STOPPED` - Manually terminated

### Example Request

```bash
GET /2025-12-01/functions/MyDurableFunction/durable-executions?Statuses=RUNNING,FAILED&MaxItems=100&StartedAfter=2026-04-01T00:00:00Z
```

### Response Format

```json
{
  "DurableExecutions": [
    {
      "DurableExecutionName": "execution-123",
      "Status": "RUNNING",
      "StartedAt": "2026-04-14T10:30:00Z",
      "FunctionArn": "arn:aws:lambda:us-east-1:123456789012:function:MyFunction:1"
    }
  ],
  "NextMarker": "eyJ0aW1lc3RhbXAiOjE2..."
}
```

### Key Features

- **Execution name filtering** - Find workflows by logical name
- **Function version filtering** - Query specific versions/aliases
- **Precise status tracking** - 5 distinct execution states
- **Time-based filtering** - Query by start time range
- **Efficient pagination** - Marker-based with reverse ordering

### Limitations

- No instance ID prefix filtering
- No response content control
- No execution history access
- No pause/resume capabilities
- No last-updated-time filtering
