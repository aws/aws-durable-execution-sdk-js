# AWS Lambda Durable Functions SDK - Agent Guide

> Build resilient, long-running AWS Lambda functions with automatic state persistence, retry logic, and workflow orchestration.

## Overview

AWS Lambda durable functions extend Lambda's programming model to build multi-step applications and AI workflows with automatic state persistence. Applications can run for days or months, survive failures, and only incur charges for actual compute time.

**Packages:**

- **JavaScript/TypeScript**: `@aws/durable-execution-sdk-js` (testing: `@aws/durable-execution-sdk-js-testing`)
- **Python**: `aws-durable-execution-sdk-python` (testing: `aws-durable-execution-sdk-python-testing`)

**Core Primitives:**

- **Steps** - Execute business logic with automatic checkpointing and transparent retries
- **Waits** - Suspend execution without compute charges (for delays, human approvals, scheduled tasks)
- **Durable Invokes** - Reliable function chaining for modular, composable architectures

## Critical Rules

### ⚠️ The Replay Model

Durable functions use a "replay" execution model. On replay (after wait/failure/resume), code runs from the beginning. Steps that already completed return their checkpointed results WITHOUT re-executing. Code OUTSIDE steps executes again on every replay.

### Rule 1: Deterministic Code Outside Steps

ALL code outside steps MUST be deterministic.

**TypeScript:**

```typescript
// ❌ WRONG: Non-deterministic code outside steps
const id = uuid.v4(); // Different on each replay!
const timestamp = Date.now(); // Different on each replay!

// ✅ CORRECT: Non-deterministic code inside steps
const id = await context.step("generate-id", async () => uuid.v4());
const timestamp = await context.step("get-time", async () => Date.now());
```

**Python:**

```python
# ❌ WRONG: Non-deterministic code outside steps
id = str(uuid.uuid4())           # Different on each replay!
timestamp = time.time()          # Different on each replay!

# ✅ CORRECT: Non-deterministic code inside steps
id = context.step(lambda _: str(uuid.uuid4()), name="generate-id")
timestamp = context.step(lambda _: time.time(), name="get-time")
```

**Must be in steps:** `Date.now()`, `new Date()`, `time.time()`, `Math.random()`, `random.random()`, UUID generation, API calls, database queries, file system operations.

### Rule 2: No Nested Durable Operations

You CANNOT call durable operations inside a step function.

**TypeScript:**

```typescript
// ❌ WRONG: Nested durable operations
await context.step("process", async () => {
  await context.wait({ seconds: 1 });  // ERROR!
  await context.step(async () => ...); // ERROR!
});

// ✅ CORRECT: Use runInChildContext for grouping
await context.runInChildContext("process", async (childCtx) => {
  await childCtx.wait({ seconds: 1 });
  await childCtx.step(async () => ...);
});
```

**Python:**

```python
# ❌ WRONG: Nested durable operations
@durable_step
def process(step_ctx: StepContext):
    context.wait(duration=Duration.from_seconds(1))  # ERROR!

# ✅ CORRECT: Use run_in_child_context for grouping
def process(child_ctx: DurableContext):
    child_ctx.wait(duration=Duration.from_seconds(1))
    child_ctx.step(some_step())

context.run_in_child_context(process, name="process")
```

### Rule 3: Closure Mutations Are Lost on Replay

Variables mutated inside steps are NOT preserved across replays.

**TypeScript:**

```typescript
// ❌ WRONG: Counter mutations lost
let counter = 0;
await context.step(async () => {
  counter++;
});
console.log(counter); // 0 on replay!

// ✅ CORRECT: Return values from steps
counter = await context.step(async () => counter + 1);
```

**Python:**

```python
# ❌ WRONG: Counter mutations lost
counter = 0
@durable_step
def increment(step_ctx: StepContext):
    nonlocal counter
    counter += 1
context.step(increment())
print(counter)  # 0 on replay!

# ✅ CORRECT: Return values from steps
counter = context.step(lambda _: counter + 1, name="increment")
```

### Rule 4: Side Effects Outside Steps Repeat

Side effects (logging, API calls) outside steps happen on EVERY replay.

**Exception:** `context.logger` is replay-aware and safe to use anywhere.

**TypeScript:**

```typescript
// ❌ WRONG
console.log("Starting");  // Logs multiple times!
await sendEmail(...);     // Sends multiple emails!

// ✅ CORRECT
context.logger.info("Starting");  // Deduplicated automatically
await context.step("email", async () => sendEmail(...));
```

**Python:**

```python
# ❌ WRONG
print("Starting")  # Prints multiple times!
send_email(...)    # Sends multiple emails!

# ✅ CORRECT
context.logger.info("Starting")  # Deduplicated automatically
context.step(lambda _: send_email(...), name="email")
```

## IAM Permissions

Durable functions require the [`AWSLambdaBasicDurableExecutionRolePolicy`](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSLambdaBasicDurableExecutionRolePolicy.html) managed policy, which includes:

- `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` - CloudWatch Logs
- `lambda:CheckpointDurableExecutions` - Persist execution state
- `lambda:GetDurableExecutionState` - Retrieve execution state

For durable invokes (calling other durable functions), also add:

- `lambda:InvokeFunction` on the target function ARN

For callbacks from external systems:

- External systems need `lambda:SendDurableExecutionCallbackSuccess` and `lambda:SendDurableExecutionCallbackFailure`

## Invoking Durable Functions

### Qualified ARNs Required

Durable functions **require qualified identifiers** for invocation. You must use a version number, alias, or `$LATEST`.

**✅ Valid invocations:**

```bash
# Full ARN with version
arn:aws:lambda:us-east-1:123456789012:function:my-function:1

# Full ARN with alias
arn:aws:lambda:us-east-1:123456789012:function:my-function:prod

# Full ARN with $LATEST
arn:aws:lambda:us-east-1:123456789012:function:my-function:$LATEST

# Function name with version/alias
my-function:1
my-function:prod
```

**❌ Invalid invocations:**

```bash
# Unqualified ARN - NOT ALLOWED
arn:aws:lambda:us-east-1:123456789012:function:my-function

# Unqualified function name - NOT ALLOWED
my-function
```

### Invocation Methods

**Synchronous** - Wait for response (limited to 15 minutes):

```bash
aws lambda invoke \
  --function-name my-durable-function:1 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"orderId": "12345"}' \
  response.json
```

**Asynchronous** - Fire-and-forget (supports up to 1 year execution):

```bash
aws lambda invoke \
  --function-name my-durable-function:1 \
  --invocation-type Event \
  --cli-binary-format raw-in-base64-out \
  --payload '{"orderId": "12345"}' \
  response.json
```

**Idempotent invocation** - Use `--durable-execution-name` to ensure the same execution is never created twice:

```bash
aws lambda invoke \
  --function-name my-durable-function:1 \
  --invocation-type Event \
  --durable-execution-name "order-processing-12345" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"orderId": "12345"}' \
  response.json
```

**Best Practice:** Use numbered versions or aliases for production. Use `$LATEST` only for development/prototyping.

## SDK API Reference

### Handler Wrapper

**TypeScript:**

```typescript
import {
  withDurableExecution,
  DurableContext,
} from "@aws/durable-execution-sdk-js";

export const handler = withDurableExecution(
  async (event: any, context: DurableContext) => {
    // Your durable workflow
    return result;
  },
);
```

**Python:**

```python
from aws_durable_execution_sdk_python import DurableContext, durable_execution

@durable_execution
def handler(event: dict, context: DurableContext) -> dict:
    # Your durable workflow
    return result
```

### Steps - Atomic Operations

**TypeScript:**

```typescript
// Basic step
const result = await context.step(async () => fetchData());

// Named step (recommended)
const result = await context.step("fetch-user", async () => fetchData());

// With retry configuration
const result = await context.step("api-call", async () => callAPI(), {
  retryStrategy: (error, attemptCount) => ({
    shouldRetry: attemptCount < 3,
    delay: { seconds: Math.pow(2, attemptCount) },
  }),
});
```

**Python:**

```python
from aws_durable_execution_sdk_python import durable_step, StepContext
from aws_durable_execution_sdk_python.config import StepConfig
from aws_durable_execution_sdk_python.retries import RetryStrategyConfig, create_retry_strategy

# Define step function with decorator
@durable_step
def fetch_user(step_ctx: StepContext, user_id: str) -> dict:
    return {"id": user_id, "name": "Jane"}

# Execute step (uses function name automatically)
result = context.step(fetch_user(user_id))

# Named step with lambda
result = context.step(lambda _: fetch_data(), name="fetch-user")

# With retry configuration
retry_config = RetryStrategyConfig(
    max_attempts=3,
    initial_delay_seconds=1,
    backoff_rate=2.0,
)
result = context.step(
    fetch_user(user_id),
    config=StepConfig(retry_strategy=create_retry_strategy(retry_config))
)
```

### Wait - Pause Execution

**TypeScript:**

```typescript
await context.wait({ seconds: 30 });
await context.wait({ hours: 1, minutes: 30 });
await context.wait("rate-limit-delay", { days: 7 });
```

**Python:**

```python
from aws_durable_execution_sdk_python.config import Duration

context.wait(duration=Duration.from_seconds(30))
context.wait(duration=Duration.from_hours(1))
context.wait(duration=Duration.from_days(7), name="rate-limit-delay")
```

### Invoke - Call Other Functions

Invoke another durable Lambda function. **Must use qualified function name** (with version or alias).

**TypeScript:**

```typescript
const result = await context.invoke(
  "process-payment",
  process.env.PAYMENT_PROCESSOR_ARN!, // e.g., arn:...function:name:$LATEST
  { amount: 100, currency: "USD" },
);
```

**Python:**

```python
import os

result = context.invoke(
    function_name=os.environ["PAYMENT_PROCESSOR_ARN"],
    payload={"amount": 100, "currency": "USD"},
    name="process-payment"
)
```

### Child Context - Group Operations

**TypeScript:**

```typescript
const result = await context.runInChildContext(
  "process-order",
  async (childCtx) => {
    const validated = await childCtx.step("validate", async () =>
      validate(data),
    );
    await childCtx.wait({ seconds: 1 });
    const processed = await childCtx.step("process", async () =>
      process(validated),
    );
    return processed;
  },
);
```

**Python:**

```python
def process_order(child_ctx: DurableContext) -> dict:
    validated = child_ctx.step(validate_step(data), name="validate")
    child_ctx.wait(duration=Duration.from_seconds(1))
    processed = child_ctx.step(process_step(validated), name="process")
    return processed

result = context.run_in_child_context(process_order, name="process-order")
```

### Wait for Callback - External Integration

**TypeScript:**

```typescript
const result = await context.waitForCallback(
  "wait-for-approval",
  async (callbackId, ctx) => {
    await sendApprovalEmail(callbackId);
  },
  { timeout: { hours: 24 } },
);
```

**Python:**

```python
from aws_durable_execution_sdk_python.waits import WaitForCallbackConfig

def submit_approval(callback_id: str):
    send_approval_email(callback_id)

result = context.wait_for_callback(
    submitter=submit_approval,
    config=WaitForCallbackConfig(timeout=Duration.from_hours(24)),
    name="wait-for-approval"
)
```

### Wait for Condition - Polling

**TypeScript:**

```typescript
const finalState = await context.waitForCondition(
  "wait-for-job",
  async (currentState, ctx) => {
    const status = await checkJobStatus(currentState.jobId);
    return { ...currentState, status };
  },
  {
    initialState: { jobId: "job-123", status: "pending" },
    waitStrategy: (state, attempt) => ({
      shouldContinue: state.status !== "completed",
      delay: { seconds: Math.min(attempt * 2, 60) },
    }),
  },
);
```

**Python:**

```python
from aws_durable_execution_sdk_python.waits import WaitForConditionConfig, ExponentialBackoff

def check_job(state: dict, check_ctx) -> dict:
    status = get_job_status(state["job_id"])
    return {"job_id": state["job_id"], "status": status}

result = context.wait_for_condition(
    check=check_job,
    config=WaitForConditionConfig(
        initial_state={"job_id": "job-123", "status": "pending"},
        condition=lambda state: state["status"] == "completed",
        wait_strategy=ExponentialBackoff(initial_wait=Duration.from_seconds(2))
    ),
    name="wait-for-job"
)
```

### Map - Process Arrays

**TypeScript:**

```typescript
const results = await context.map(
  "process-items",
  items,
  async (ctx, item, index) => {
    return await ctx.step(`process-${index}`, async () => process(item));
  },
  {
    maxConcurrency: 5,
    completionConfig: {
      minSuccessful: 8,
      toleratedFailureCount: 2,
    },
  },
);

results.throwIfError();
const allResults = results.getResults();
```

**Python:**

```python
from aws_durable_execution_sdk_python.concurrency import MapConfig, CompletionConfig

def process_item(ctx: DurableContext, item: dict, index: int) -> dict:
    return ctx.step(lambda _: process(item), name=f"process-{index}")

results = context.map(
    items=items,
    func=process_item,
    config=MapConfig(
        max_concurrency=5,
        completion_config=CompletionConfig(
            min_successful=8,
            tolerated_failure_count=2
        )
    ),
    name="process-items"
)

results.throw_if_error()
all_results = results.get_results()
```

### Parallel - Parallel Branches

**TypeScript:**

```typescript
const results = await context.parallel(
  "parallel-ops",
  [
    { name: "task1", func: async (ctx) => ctx.step(async () => fetchData1()) },
    { name: "task2", func: async (ctx) => ctx.step(async () => fetchData2()) },
  ],
  { maxConcurrency: 2 },
);
```

**Python:**

```python
from aws_durable_execution_sdk_python.concurrency import ParallelConfig

def task1(ctx: DurableContext):
    return ctx.step(lambda _: fetch_data1(), name="fetch1")

def task2(ctx: DurableContext):
    return ctx.step(lambda _: fetch_data2(), name="fetch2")

results = context.parallel(
    branches=[
        {"name": "task1", "func": task1},
        {"name": "task2", "func": task2},
    ],
    config=ParallelConfig(max_concurrency=2),
    name="parallel-ops"
)
```

## Testing Reference

### TypeScript Setup

```bash
npm install --save-dev @aws/durable-execution-sdk-js-testing
```

```typescript
import {
  LocalDurableTestRunner,
  OperationType,
  OperationStatus,
} from "@aws/durable-execution-sdk-js-testing";

describe("My Durable Function", () => {
  beforeAll(() =>
    LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }),
  );
  afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

  it("should execute workflow", async () => {
    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const execution = await runner.run({ payload: { userId: "123" } });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ success: true });

    // Get operations BY NAME (not by index!)
    const fetchStep = runner.getOperation("fetch-user");
    expect(fetchStep.getType()).toBe(OperationType.STEP);
    expect(fetchStep.getStatus()).toBe(OperationStatus.SUCCEEDED);
  });
});
```

### Python Setup

```bash
pip install aws-durable-execution-sdk-python-testing
```

```python
import pytest
from aws_durable_execution_sdk_python_testing import InvocationStatus
from my_module import handler

@pytest.mark.durable_execution(
    handler=handler,
    lambda_function_name="my_function",
)
def test_workflow(durable_runner):
    """Test durable function workflow."""
    with durable_runner:
        result = durable_runner.run(input={"user_id": "123"}, timeout=10)

    assert result.status is InvocationStatus.SUCCEEDED
    assert result.result == {"success": True}

    # Get step by name
    step_result = result.get_step("fetch-user")
    assert step_result.status is InvocationStatus.SUCCEEDED
```

### Testing Key Points

- ✅ Use `runner.getOperation("name")` (JS) or `result.get_step("name")` (Python) - not by index
- ✅ Name all operations for test reliability
- ✅ JSON.stringify callback parameters (JS) / ensure JSON-serializable (Python)
- ✅ Parse callback results (they're JSON strings)
- ✅ Wrap event data in `payload: {}` (JS) or `input={}` (Python)

## Common Patterns

### Multi-Step Workflow

**TypeScript:**

```typescript
export const handler = withDurableExecution(async (event, context) => {
  const validated = await context.step("validate", async () =>
    validateInput(event),
  );
  const processed = await context.step("process", async () =>
    processData(validated),
  );
  await context.wait("cooldown", { seconds: 30 });
  await context.step("notify", async () => sendNotification(processed));
  return { success: true, data: processed };
});
```

**Python:**

```python
@durable_execution
def handler(event: dict, context: DurableContext) -> dict:
    validated = context.step(validate_input(event), name="validate")
    processed = context.step(process_data(validated), name="process")
    context.wait(duration=Duration.from_seconds(30), name="cooldown")
    context.step(send_notification(processed), name="notify")
    return {"success": True, "data": processed}
```

### GenAI Agent (Agentic Loop)

**TypeScript:**

```typescript
export const handler = withDurableExecution(async (event, context) => {
  const messages = [{ role: "user", content: event.prompt }];

  while (true) {
    const { response, tool } = await context.step("invoke-model", async () =>
      invokeAIModel(messages),
    );

    if (tool == null) return response;

    const toolResult = await context.step(`tool-${tool.name}`, async () =>
      executeTool(tool, response),
    );
    messages.push({ role: "assistant", content: toolResult });
  }
});
```

**Python:**

```python
@durable_execution
def handler(event: dict, context: DurableContext) -> str:
    messages = [{"role": "user", "content": event["prompt"]}]

    while True:
        result = context.step(
            lambda _: invoke_ai_model(messages),
            name="invoke-model"
        )

        if result.get("tool") is None:
            return result["response"]

        tool = result["tool"]
        tool_result = context.step(
            lambda _: execute_tool(tool, result["response"]),
            name=f"tool-{tool['name']}"
        )
        messages.append({"role": "assistant", "content": tool_result})
```

### Human-in-the-Loop Approval

**TypeScript:**

```typescript
export const handler = withDurableExecution(async (event, context) => {
  const plan = await context.step("generate-plan", async () =>
    generatePlan(event),
  );

  const answer = await context.waitForCallback(
    "wait-for-approval",
    async (callbackId) =>
      sendApprovalEmail(event.approverEmail, plan, callbackId),
    { timeout: { hours: 24 } },
  );

  if (answer === "APPROVED") {
    await context.step("execute", async () => performAction(plan));
    return { status: "completed" };
  }
  return { status: "rejected" };
});
```

**Python:**

```python
@durable_execution
def handler(event: dict, context: DurableContext) -> dict:
    plan = context.step(generate_plan(event), name="generate-plan")

    def submit_approval(callback_id: str):
        send_approval_email(event["approver_email"], plan, callback_id)

    answer = context.wait_for_callback(
        submitter=submit_approval,
        config=WaitForCallbackConfig(timeout=Duration.from_hours(24)),
        name="wait-for-approval"
    )

    if answer == "APPROVED":
        context.step(perform_action(plan), name="execute")
        return {"status": "completed"}
    return {"status": "rejected"}
```

### Saga Pattern (Compensating Transactions)

**TypeScript:**

```typescript
export const handler = withDurableExecution(async (event, context) => {
  const compensations: Array<{ name: string; fn: () => Promise<void> }> = [];

  try {
    await context.step("book-flight", async () => flightClient.book(event));
    compensations.push({
      name: "cancel-flight",
      fn: () => flightClient.cancel(event),
    });

    await context.step("book-hotel", async () => hotelClient.book(event));
    compensations.push({
      name: "cancel-hotel",
      fn: () => hotelClient.cancel(event),
    });

    return { success: true };
  } catch (error) {
    for (const comp of compensations.reverse()) {
      await context.step(comp.name, async () => comp.fn());
    }
    throw error;
  }
});
```

**Python:**

```python
@durable_execution
def handler(event: dict, context: DurableContext) -> dict:
    compensations = []

    try:
        context.step(book_flight(event), name="book-flight")
        compensations.append(("cancel-flight", lambda: cancel_flight(event)))

        context.step(book_hotel(event), name="book-hotel")
        compensations.append(("cancel-hotel", lambda: cancel_hotel(event)))

        return {"success": True}
    except Exception as error:
        for name, comp_fn in reversed(compensations):
            context.step(lambda _: comp_fn(), name=name)
        raise error
```

## Infrastructure as Code

Deploy durable functions using CloudFormation, CDK, or SAM. All require:

1. Enable durable execution on the function
2. Grant checkpoint permissions to the execution role
3. Publish a version or create an alias (qualified ARNs required)

### AWS CloudFormation

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Resources:
  DurableFunctionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy

  DurableFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: myDurableFunction
      Runtime: nodejs22.x # or python3.12
      Handler: index.handler
      Role: !GetAtt DurableFunctionRole.Arn
      Code:
        ZipFile: |
          // Your durable function code
      DurableConfig:
        ExecutionTimeout: 3600
        RetentionPeriodInDays: 7

  DurableFunctionVersion:
    Type: AWS::Lambda::Version
    Properties:
      FunctionName: !Ref DurableFunction

  DurableFunctionAlias:
    Type: AWS::Lambda::Alias
    Properties:
      FunctionName: !Ref DurableFunction
      FunctionVersion: !GetAtt DurableFunctionVersion.Version
      Name: prod
```

### AWS CDK (TypeScript)

```typescript
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";

const durableFunction = new lambda.Function(this, "DurableFunction", {
  runtime: lambda.Runtime.NODEJS_22_X, // or PYTHON_3_12
  handler: "index.handler",
  code: lambda.Code.fromAsset("lambda"),
  durableConfig: {
    executionTimeout: cdk.Duration.hours(1),
    retentionPeriod: cdk.Duration.days(7),
  },
});

// CDK automatically adds checkpoint permissions when durableConfig is set

// Create version and alias
const version = durableFunction.currentVersion;
const alias = new lambda.Alias(this, "ProdAlias", {
  aliasName: "prod",
  version: version,
});
```

### AWS SAM

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31

Resources:
  DurableFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: myDurableFunction
      Runtime: nodejs22.x # or python3.12
      Handler: index.handler
      CodeUri: ./src
      DurableConfig:
        ExecutionTimeout: 3600
        RetentionPeriodInDays: 7
      Policies:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicDurableExecutionRolePolicy
      AutoPublishAlias: prod
```

## Related Documentation

**AWS Documentation:**

- [AWS Lambda Durable Functions Guide](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html)
- [Lambda API Reference](https://docs.aws.amazon.com/lambda/latest/api/)
- [Invoking Durable Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-invoking.html)
- [Deploy with IaC](https://docs.aws.amazon.com/lambda/latest/dg/durable-getting-started-iac.html)
- [AWSLambdaBasicDurableExecutionRolePolicy](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSLambdaBasicDurableExecutionRolePolicy.html)

**JavaScript/TypeScript SDK:**

- [SDK Repository](https://github.com/aws/aws-durable-execution-sdk-js)
- [SDK README](https://github.com/aws/aws-durable-execution-sdk-js/blob/main/packages/aws-durable-execution-sdk-js/README.md)
- [Concepts & Use Cases](https://github.com/aws/aws-durable-execution-sdk-js/blob/main/packages/aws-durable-execution-sdk-js/src/documents/CONCEPTS.md)
- [Testing SDK](https://github.com/aws/aws-durable-execution-sdk-js/blob/main/packages/aws-durable-execution-sdk-js-testing/README.md)

**Python SDK:**

- [SDK Repository](https://github.com/aws/aws-durable-execution-sdk-python)
- [Documentation Index](https://github.com/aws/aws-durable-execution-sdk-python/blob/main/docs/index.md)
- [Getting Started](https://github.com/aws/aws-durable-execution-sdk-python/blob/main/docs/getting-started.md)
- [Steps](https://github.com/aws/aws-durable-execution-sdk-python/blob/main/docs/core/steps.md)
- [Wait Operations](https://github.com/aws/aws-durable-execution-sdk-python/blob/main/docs/core/wait.md)
- [Callbacks](https://github.com/aws/aws-durable-execution-sdk-python/blob/main/docs/core/callbacks.md)
- [Testing Patterns](https://github.com/aws/aws-durable-execution-sdk-python/blob/main/docs/testing-patterns/basic-tests.md)
