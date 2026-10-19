# AWS vs Azure Durable Functions API Comparison

## Overview

| Aspect                 | AWS Lambda       | Azure Functions          |
| ---------------------- | ---------------- | ------------------------ |
| **Terminology**        | Executions       | Orchestrations/Instances |
| **Status Values**      | 5                | 8+                       |
| **Filtering Approach** | Business-focused | Operations-focused       |

## Filtering Capabilities

### ✅ AWS Advantages

| Feature              | AWS                       | Azure | Impact                          |
| -------------------- | ------------------------- | ----- | ------------------------------- |
| **Execution Name**   | ✅ `DurableExecutionName` | ❌    | Find workflows by logical name  |
| **Function Version** | ✅ `Qualifier`            | ❌    | Query specific versions/aliases |
| **Timeout Status**   | ✅ `TIMED_OUT`            | ❌    | Distinguish timeout failures    |
| **Result Ordering**  | ✅ `ReverseOrder`         | ❌    | Control sort direction          |

### ✅ Azure Advantages

| Feature              | AWS      | Azure                      | Impact                      |
| -------------------- | -------- | -------------------------- | --------------------------- |
| **ID Prefix Filter** | ❌       | ✅ `instanceIdPrefix`      | Pattern-based searching     |
| **Granular Status**  | 5 values | 8+ values                  | Better lifecycle visibility |
| **Response Control** | ❌       | ✅ `showInput/showHistory` | Optimize response size      |
| **Pause/Resume**     | ❌       | ✅ `Suspended` status      | Workflow maintenance        |

## Status Mapping

| AWS Status  | Azure Equivalent          | Notes                                 |
| ----------- | ------------------------- | ------------------------------------- |
| `RUNNING`   | `Running` + `Pending`     | Azure splits execution states         |
| `SUCCEEDED` | `Completed`               | Direct mapping                        |
| `FAILED`    | `Failed`                  | Direct mapping                        |
| `TIMED_OUT` | ❌ No equivalent          | AWS-specific                          |
| `STOPPED`   | `Terminated` + `Canceled` | Azure distinguishes termination types |
| ❌          | `ContinuedAsNew`          | Azure workflow restart                |
| ❌          | `Suspended`               | Azure pause/resume                    |
| ❌          | `Unknown`                 | Azure error state                     |

## Gap Analysis

### Missing in AWS

- Instance ID prefix filtering
- Response content control
- Execution history access
- Pause/resume capabilities
- Granular status differentiation

### Missing in Azure

- Execution name filtering
- Function version filtering
- Timeout-specific status
- Result ordering control
- Enterprise deployment patterns

### Missing in Both

- Last-updated-time filtering
- Advanced query syntax (AND/OR)
- Metadata/tag filtering
- Performance-based filtering

## Recommendations

### For AWS

**High Priority:**

- Add `instanceIdPrefix` parameter
- Add response content control
- Consider pause/resume operations

**Medium Priority:**

- Add `lastUpdatedAfter/Before` filtering
- Separate `Canceled` from `Terminated` status

### For Azure

**High Priority:**

- Add execution name filtering
- Add function version filtering
- Add result ordering control

**Medium Priority:**

- Add `TimedOut` status
- Add last-updated-time filtering

## Conclusion

**Azure** provides more comprehensive operational monitoring with granular status tracking and flexible response control.

**AWS** offers better enterprise deployment support with execution name and version filtering.

Both platforms need significant improvements in advanced querying capabilities, particularly last-updated-time filtering for long-running workflow monitoring.
