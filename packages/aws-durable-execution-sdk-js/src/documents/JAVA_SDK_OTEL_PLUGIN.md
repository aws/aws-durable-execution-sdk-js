# OTel Instrumentation Plugin for the Java SDK

## Overview

The Java SDK (`aws-durable-execution-sdk-java`) has the same execution model as the TypeScript and Python SDKs. Handlers extend `DurableHandler<I, O>` and implement `handleRequest(I input, DurableContext ctx)`.

The Java SDK already has a `DurableConfig` extension point (via `createConfiguration()`) and a `DurableLogger` via `ctx.getLogger()` that uses MDC for structured logging.

---

## Proposed Plugin Interface for Java

```java
public interface DurableInstrumentationPlugin {
    default void onExecutionStart(InvocationInfo info) {}
    default void onExecutionEnd(ExecutionEndInfo info) {}
    default void onInvocationStart(InvocationInfo info) {}
    default void onInvocationEnd(InvocationInfo info) {}
    default void onOperationStart(OperationInfo info) {}
    default void onOperationEnd(OperationInfo info, Optional<Exception> error) {}
    default void onOperationAttemptStart(AttemptInfo info) {}
    default void onOperationAttemptEnd(AttemptEndInfo info) {}

    /**
     * Return key-value pairs to inject into every log line via MDC.
     */
    default Map<String, String> enrichLogContext(Optional<OperationInfo> info) {
        return Map.of();
    }
}
```

Supporting types:

```java
public record InvocationInfo(String requestId, String executionArn) {}
public record OperationInfo(String operationId, Optional<String> operationName,
                            String operationType, Optional<String> parentOperationId) {}
public record AttemptInfo(String operationId, Optional<String> operationName,
                          String operationType, int attempt) {}
public record AttemptEndInfo(String operationId, Optional<String> operationName,
                             String operationType, int attempt,
                             String outcome, // "succeeded" | "failed" | "retrying"
                             Optional<Exception> error,
                             Optional<Double> nextAttemptDelaySeconds) {}
```

---

## Registration via `DurableConfig`

```java
@Override
protected DurableConfig createConfiguration() {
    return DurableConfig.builder()
        .withPlugins(List.of(new OtelPlugin()))
        .build();
}
```

---

## Context Propagation — Configurable `ContextExtractor`

```java
@FunctionalInterface
public interface ContextExtractor {
    Context extract(InvocationInfo info);
}

// Built-in extractors:
ContextExtractor xRayContextExtractor = info -> {
    String xrayTraceId = System.getenv("_X_AMZN_TRACE_ID");
    if (xrayTraceId == null) return Context.current();
    return GlobalOpenTelemetry.getPropagators().getTextMapPropagator()
        .extract(Context.current(), Map.of("x-amzn-trace-id", xrayTraceId),
            (carrier, key) -> carrier.get(key));
};
```

Must be called per invocation (not in the constructor) — `_X_AMZN_TRACE_ID` and `clientContext` are updated by the Lambda runtime before each invocation.

---

## Key Differences from TypeScript and Python

| Aspect              | TypeScript                    | Python                   | Java                                           |
| ------------------- | ----------------------------- | ------------------------ | ---------------------------------------------- |
| Plugin registration | `{ plugins: [...] }`          | `plugins=[...]`          | `DurableConfig.builder().withPlugins(...)`     |
| `IdGenerator`       | `new AWSXRayIdGenerator()`    | `AwsXRayIdGenerator()`   | `AwsXRayIdGenerator.getInstance()`             |
| Context propagation | `otelContext.with(ctx, fn)`   | `context.attach(ctx)`    | `ctx.makeCurrent()` → `Scope`                  |
| `forceFlush`        | `await provider.forceFlush()` | `provider.force_flush()` | `tracerProvider.forceFlush().join()`           |
| Log enrichment      | Custom fields in JSON         | Custom fields in JSON    | MDC entries                                    |
| Thread safety       | Single-threaded (Node.js)     | GIL + threads            | Full multi-threading — use `ConcurrentHashMap` |

---

## Java-Specific Considerations

**Thread safety:** OTel's `Context.makeCurrent()` uses `ThreadLocal`. When the SDK runs user operations on background threads, the OTel context must be explicitly propagated:

```java
Context parentContext = Context.current();
executorService.submit(() -> {
    try (Scope scope = parentContext.makeCurrent()) {
        doWork();
    }
});
```

**`SimpleSpanProcessor` vs `BatchSpanProcessor`:** Use `SimpleSpanProcessor` in Lambda. `BatchSpanProcessor` uses a background thread that may not flush before Lambda freezes.

**`Scope` lifecycle:** `Context.makeCurrent()` returns a `Scope` that must be closed to restore the previous context. Close it in `onInvocationEnd` to avoid context leaks across invocations.
