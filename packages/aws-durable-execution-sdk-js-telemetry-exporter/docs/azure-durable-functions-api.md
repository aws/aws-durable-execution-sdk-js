# Azure Durable Functions API

## Get All Instances Status

**Endpoint:** `GET /runtime/webhooks/durabletask/instances`

### Parameters

| Parameter           | Type  | Description                            |
| ------------------- | ----- | -------------------------------------- |
| `taskHub`           | Query | Task hub name                          |
| `connection`        | Query | Storage connection name                |
| `code`              | Query | Authorization key (required)           |
| `createdTimeFrom`   | Query | ISO8601 timestamp filter (inclusive)   |
| `createdTimeTo`     | Query | ISO8601 timestamp filter (inclusive)   |
| `runtimeStatus`     | Query | Comma-separated status list            |
| `instanceIdPrefix`  | Query | Filter by instance ID prefix           |
| `top`               | Query | Maximum results to return              |
| `showInput`         | Query | Include input data (true/false)        |
| `showHistoryOutput` | Query | Include execution history (true/false) |

### Runtime Status Values

- `Unknown` (-1) - Error state
- `Running` (0) - Currently executing
- `Completed` (1) - Finished successfully
- `ContinuedAsNew` (2) - Restarted with new history
- `Failed` (3) - Failed with error
- `Canceled` (4) - Gracefully canceled
- `Terminated` (5) - Abruptly terminated
- `Pending` (6) - Queued for execution
- `Suspended` - Paused (resumable)

### Example Request

```bash
GET /runtime/webhooks/durabletask/instances?runtimeStatus=Running,Failed&top=100&createdTimeFrom=2026-04-01T00:00:00Z&code=XXX
```

### Response Format

```json
[
  {
    "instanceId": "abc123def456",
    "runtimeStatus": "Running",
    "input": { "orderId": "12345" },
    "output": null,
    "createdTime": "2026-04-14T10:30:00Z",
    "lastUpdatedTime": "2026-04-14T10:35:00Z",
    "customStatus": { "progress": 50 }
  }
]
```

### Key Features

- **Instance ID prefix filtering** - Find related orchestrations
- **Granular status tracking** - 8+ distinct runtime states
- **Response content control** - Customize included data
- **Pause/resume support** - Suspended status and operations
- **Custom status tracking** - Application-defined progress
- **Continuation tokens** - Efficient pagination

### Limitations

- No execution name filtering
- No function version filtering
- No timeout-specific status
- No result ordering control
- No last-updated-time filtering
