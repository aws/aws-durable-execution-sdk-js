# Vercel Workflow Platform

## Overview

Vercel Workflow is a fully managed platform built on the open-source Workflow SDK, enabling developers to build durable, resumable TypeScript applications and AI agents. Unlike traditional workflow orchestrators, Vercel Workflow uses simple directives (`'use workflow'` and `'use step'`) to create workflows that can pause, resume, and maintain state.

## Platform Architecture

**Technology Stack:**

- **Language**: TypeScript/JavaScript only
- **Infrastructure**: Fully managed by Vercel
- **Execution**: Vercel Functions + Vercel Queues
- **Storage**: Managed persistence with optimized database
- **Deployment**: Integrated with Vercel's serverless platform

**Key Features:**

- **Resumable**: Pause for minutes or months, resume from exact point
- **Durable**: Survive deployments and crashes with deterministic replays
- **Observable**: Built-in logs, metrics, and tracing in Vercel dashboard
- **Idiomatic**: Write async/await JavaScript with two directives

## Workflow Definition

### Basic Workflow Syntax

```typescript
export async function userSignup(email: string) {
  "use workflow";

  const user = await createUser(email);
  await sendWelcomeEmail(email);

  // Pause for 7 days without consuming resources
  await sleep("7 days");
  await sendOneWeekCheckInEmail(email);

  return { userId: user.id, status: "done" };
}
```

### Step Definition

```typescript
export async function sendWelcomeEmail(email: string) {
  "use step";

  const resend = new Resend("YOUR_API_KEY");
  const resp = await resend.emails.send({
    from: "Acme <onboarding@resend.dev>",
    to: [email],
    subject: "Welcome!",
    html: "Thanks for joining Acme.",
  });

  if (resp.error) {
    throw new FatalError(resp.error.message);
  }

  return resp.data;
}
```

## Workflow Management API

### Starting Workflows

Workflows are started through **code execution**, not REST API calls:

```typescript
// HTTP Trigger - app/api/start-workflow/route.ts
import { workflow } from "workflow";
import { myWorkflow } from "../../workflows/my-workflow";

export async function POST(request: Request) {
  const { userId } = await request.json();
  const run = await workflow.start(myWorkflow, userId);
  return Response.json({ runId: run.id });
}
```

### SDK Query Capabilities

**Available Methods:**

```typescript
// Get individual workflow run status
const run = await workflow.getRun("run_abc123");
console.log(run.id); // Run ID
console.log(run.status); // 'running', 'completed', 'failed', 'paused'
console.log(run.result); // Final result (if completed)
console.log(run.error); // Error details (if failed)
console.log(run.createdAt); // Start timestamp

// Start new workflow
const run = await workflow.start(myWorkflow, inputData);
```

**What You CAN Do:**

- ✅ Get individual workflow run status (if you have run ID)
- ✅ Check if specific run is complete
- ✅ Get workflow results and error details
- ✅ Start new workflows

**What You CANNOT Do:**

- ❌ List all running workflows (no `workflow.listRuns()`)
- ❌ Filter workflows by status (no bulk query capabilities)
- ❌ Search workflows by name (no search functionality)
- ❌ Get workflows by date range (no time-based filtering)
- ❌ Count active workflows (no aggregation methods)
- ❌ Cancel/pause workflows (no lifecycle management)
- ❌ Get workflow history (no audit trail access)
- ❌ Bulk operations (no batch processing)

**SDK Limitations:**

- Individual queries only - must know specific run IDs
- No discovery mechanism - cannot find existing workflows
- No filtering capabilities - cannot query by criteria
- Intentionally limited to basic run management

### Workflow Status Values

- `running` - Currently executing
- `paused` - Suspended (waiting for sleep/external event)
- `completed` - Finished successfully
- `failed` - Failed with error
- `cancelled` - Manually cancelled

## Observability & Monitoring

### Vercel Dashboard Integration

- **Real-time monitoring**: Live workflow execution tracking
- **Step-by-step visibility**: Individual step status and timing
- **Error tracking**: Detailed error logs and stack traces
- **Performance metrics**: Execution duration and resource usage

### Dashboard Filtering Capabilities

**Workflow Run Details Page:**

- **Run-level observability**: Step progression, payloads, outputs, performance metrics
- **"View Logs" button**: Direct jump to filtered logs for specific runs
- **Run status tracking**: Visual status indicators for each workflow run

**Logs Tab Filtering:**

- **Workflow Run ID**: Filter logs by specific workflow execution
- **Workflow Step ID**: Filter logs by individual step within a run
- **Consolidated view**: All logs for a workflow run in one place

### Query Builder (Observability Plus)

**Available Filters:**

- **Environment**: production, preview, development
- **Project**: Filter by Vercel project name
- **Workflow**: Filter by workflow function name
- **Step**: Filter by individual step names
- **Run Status**: Filter by workflow run status
- **Step Status**: Filter by individual step status
- **Time Range**: Custom date/time filtering

**Grouping Options:**

- Group by environment
- Group by project
- Group by workflow name
- Group by step name
- Group by status (run or step level)

**Query Examples:**

```sql
-- Workflow runs by status
SELECT COUNT(*) FROM workflow_runs
WHERE status = 'failed'
  AND created_at >= '2026-04-01'
  GROUP BY workflow_name;

-- Step performance analysis
SELECT AVG(duration) FROM workflow_steps
WHERE step_name = 'sendEmail'
  AND environment = 'production';

-- Error rate by workflow
SELECT workflow_name,
       COUNT(*) as total_runs,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_runs
FROM workflow_runs
WHERE environment = 'production'
GROUP BY workflow_name;
```

## REST API (Private/Internal)

**Important Note**: Vercel Workflow dashboard filtering **must** use underlying APIs - web interfaces cannot function without them. However, these APIs are:

### Current API Status

- **Private/Internal APIs**: Dashboard uses undocumented internal endpoints
- **No Public Documentation**: Workflow-specific endpoints not in official REST API docs
- **Dashboard-Only Access**: Filtering capabilities only available through web UI
- **Reverse Engineering Possible**: Internal APIs could be discovered via browser network inspection

### Documented Public API (Limited)

```bash
# General Vercel REST API (no workflow-specific endpoints)
GET https://api.vercel.com/v9/projects/{projectId}/deployments
Authorization: Bearer <token>

# Function logs (includes workflow execution logs)
GET https://api.vercel.com/v2/deployments/{deploymentId}/events
Authorization: Bearer <token>
```

### Likely Internal API Structure

Based on dashboard capabilities, internal APIs likely include:

```bash
# Hypothetical internal endpoints (not documented)
GET /api/v1/projects/{projectId}/workflows/runs?status=failed&environment=production
GET /api/v1/projects/{projectId}/workflows/{workflowId}/steps
GET /api/v1/observability/workflows/query
```

**Reality**: The dashboard filtering works because Vercel has internal APIs that power these features, but they choose not to expose them publicly or document them for external use.

## Key Limitations

### API Limitations

- **No public REST API** for workflow management (APIs exist but are private/internal)
- **No official documentation** for workflow-specific endpoints
- **Dashboard-only access** to workflow filtering and querying
- **Reverse engineering required** to access internal APIs (not recommended for production)
- **No programmatic integration** without using undocumented endpoints

### Platform Limitations

- **TypeScript/JavaScript only** - No other language support
- **Vercel platform dependency** - Cannot run outside Vercel
- **No self-hosting option** - Fully managed service only
- **Limited customization** of execution environment

### Querying Limitations

- **No SQL access** to workflow data outside dashboard
- **No bulk operations** on workflow runs
- **No external monitoring** integration APIs
- **Limited historical data** export capabilities

## Comparison with Other Platforms

### Advantages

- **Simplest syntax**: Just two directives (`'use workflow'`, `'use step'`)
- **Zero infrastructure**: Fully managed by Vercel
- **Integrated observability**: Built into Vercel dashboard
- **TypeScript-native**: First-class TypeScript support
- **Serverless-optimized**: Designed for serverless execution

### Disadvantages

- **Platform lock-in**: Cannot migrate to other platforms
- **Limited language support**: TypeScript/JavaScript only
- **No programmatic API**: Dashboard-only workflow management
- **Vercel dependency**: Requires Vercel for deployment
- **Limited enterprise features**: No advanced workflow patterns

## Use Cases

### Ideal For:

- **AI agent workflows** with pause/resume capabilities
- **User onboarding flows** with time-based delays
- **Content generation pipelines** with human approval steps
- **E-commerce order processing** with external integrations
- **Serverless-first applications** on Vercel platform

### Not Suitable For:

- **Multi-language environments** requiring diverse runtime support
- **Complex enterprise workflows** needing advanced orchestration
- **High-volume processing** requiring custom scaling logic
- **External platform integration** needing programmatic APIs
- **Self-hosted deployments** or hybrid cloud scenarios

## Getting Started

### Installation

```bash
npm install workflow
```

### Basic Setup

```typescript
// app/workflows/welcome.ts
export async function welcomeWorkflow(userId: string) {
  "use workflow";

  const user = await getUser(userId);
  const email = await generateWelcomeEmail(user);
  await sendEmail(email);

  return { success: true };
}

// app/api/start-welcome/route.ts
import { workflow } from "workflow";
import { welcomeWorkflow } from "../../workflows/welcome";

export async function POST(request: Request) {
  const { userId } = await request.json();
  const run = await workflow.start(welcomeWorkflow, userId);
  return Response.json({ runId: run.id });
}
```

### Deployment

Workflows deploy automatically with Vercel deployments - no additional configuration required.

## Pricing & Limits

- **Beta availability**: Currently in beta on all Vercel plans
- **Observability Plus**: Required for advanced querying (Pro/Enterprise)
- **Function limits**: Subject to Vercel Functions limits
- **Queue limits**: Subject to Vercel Queues limits
- **Storage limits**: Managed persistence included in platform pricing
