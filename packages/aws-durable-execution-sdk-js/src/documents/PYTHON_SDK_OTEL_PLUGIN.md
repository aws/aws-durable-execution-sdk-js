# OTel Instrumentation Plugin for the Python SDK

## Overview

The Python SDK (`aws-durable-execution-sdk-python`) has the same execution model as the TypeScript SDK. All the OTel challenges documented for TypeScript apply equally to Python. This document describes what needs to be done to bring the Python SDK to parity with the TypeScript plugin design.

---

## Proposed Plugin Interface for Python

```python
from abc import ABC
from dataclasses import dataclass
from typing import Optional, Dict, Any

@dataclass
class OperationInfo:
    operation_id: str
    operation_name: Optional[str]
    operation_type: str
    parent_operation_id: Optional[str] = None
    attempt: Optional[int] = None
    attributes: Optional[Dict[str, Any]] = None

@dataclass
class AttemptInfo(OperationInfo):
    attempt: int = 1

@dataclass
class AttemptEndInfo(AttemptInfo):
    outcome: str = "succeeded"  # "succeeded" | "failed" | "retrying"
    error: Optional[Exception] = None
    next_attempt_delay_seconds: Optional[float] = None

@dataclass
class InvocationInfo:
    request_id: str
    execution_arn: str

@dataclass
class ExecutionEndInfo(InvocationInfo):
    status: str  # "SUCCEEDED" | "FAILED"
    error: Optional[Exception] = None


class DurableInstrumentationPlugin(ABC):
    """Base class for instrumentation plugins. Override only the methods you need."""

    def on_execution_start(self, info: InvocationInfo) -> None: pass
    def on_execution_end(self, info: ExecutionEndInfo) -> None: pass
    def on_invocation_start(self, info: InvocationInfo) -> None: pass
    def on_invocation_end(self, info: InvocationInfo) -> None: pass
    def on_operation_start(self, info: OperationInfo) -> None: pass
    def on_operation_end(self, info: OperationInfo, error: Optional[Exception] = None) -> None: pass
    def on_operation_attempt_start(self, info: AttemptInfo) -> None: pass
    def on_operation_attempt_end(self, info: AttemptEndInfo) -> None: pass
    def enrich_log_context(self, info: Optional[OperationInfo]) -> Optional[Dict[str, Any]]: return None
```

---

## Context Propagation — Configurable `context_extractor`

Rather than hardcoding X-Ray extraction, the plugin accepts a `context_extractor` callable. Built-in extractors are provided as named exports:

```python
def xray_context_extractor(info: InvocationInfo):
    """Default: extract from _X_AMZN_TRACE_ID"""
    xray_trace_id = os.environ.get("_X_AMZN_TRACE_ID")
    if xray_trace_id:
        return propagate.extract({"x-amzn-trace-id": xray_trace_id})
    return otel_context.get_current()

def w3c_client_context_extractor(info: InvocationInfo):
    """Extract traceparent from clientContext.custom"""
    traceparent = (info.lambda_context.client_context or {}).get("custom", {}).get("traceparent")
    if traceparent:
        return propagate.extract({"traceparent": traceparent})
    return otel_context.get_current()
```

Must be called per invocation (not at module load) — `_X_AMZN_TRACE_ID` and `clientContext` are updated by the Lambda runtime before each invocation.

---

## Registration

```python
@durable_execution(plugins=[OtelPlugin()])
def handler(event: dict, context: DurableContext) -> dict:
    ...
```

---

## Key Differences from TypeScript

| Aspect                                        | TypeScript                                          | Python                                                        |
| --------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Plugin registration                           | `withDurableExecution(handler, { plugins: [...] })` | `@durable_execution(plugins=[...])`                           |
| `IdGenerator`                                 | `new AWSXRayIdGenerator()`                          | `AwsXRayIdGenerator()` from `opentelemetry-sdk-extension-aws` |
| Context propagation                           | `otelContext.with(ctx, fn)`                         | `context.attach(ctx)` / `context.detach(token)`               |
| `forceFlush`                                  | `await provider.forceFlush()`                       | `provider.force_flush()` (synchronous)                        |
| `SimpleSpanProcessor` vs `BatchSpanProcessor` | Use `SimpleSpanProcessor` in Lambda                 | Same                                                          |

---

## What Needs to Be Built

1. `DurableInstrumentationPlugin` base class in `aws_durable_execution_sdk_python/plugin.py`
2. `plugins` parameter on `@durable_execution`
3. Plugin runner — fan out all hook calls to all registered plugins
4. Hook call sites in each operation handler
5. `enrich_log_context` in the logger
6. No OTel in `install_requires` — move to optional extras
