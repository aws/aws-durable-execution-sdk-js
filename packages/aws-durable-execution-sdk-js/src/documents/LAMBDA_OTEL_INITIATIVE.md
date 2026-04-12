# Lambda Platform OTel Initiative and Durable Executions

## What the Lambda Team Is Building

- **OTLP Forwarder (P0)** — A local in-sandbox OTLP endpoint that collects OTel signals from the runtime and delivers them to CloudWatch OTLP endpoints. Customers point their OTLP exporter at a local address instead of running a sidecar collector.
- **W3C Context Propagation (P0)** — Native support for `traceparent`/`tracestate` headers across Lambda frontends and execution environments.
- **Cold start reduction (P0)** — Reducing the latency overhead of OTel auto-instrumentation at the runtime level.
- **3P egress via CloudWatch Telemetry Pipelines (P1)** — Routing OTel signals through CloudWatch first, then to third-party backends.

---

## What the Lambda Team Said About Durable Executions

The initiative explicitly calls out durable executions as a known gap (`[P?] Durable Functions - Enhanced Observability`):

> - _tracing might be broken_
> - _Sandbox unaware of DAR context_
> - _traces for 3P are broken currently — need problem statement & desired CX doc_

This is consistent with our own findings. Our documents could directly feed into the problem statement they need.

---

## These Projects Are Independent and Not Blocking Each Other

- Our plugin works today with the existing ADOT sidecar + gRPC exporter setup
- Customers can adopt our plugin before the Lambda platform OTel work ships
- When the Lambda platform work ships, customers benefit automatically — no plugin changes required in most cases

---

## How the Lambda Platform Work Improves the Experience

### OTLP Forwarder — Simpler setup

```typescript
// Today: requires ADOT sidecar + gRPC exporter + collector.yaml
new OTLPTraceExporter({
  url: "http://localhost:4317",
  credentials: createInsecure(),
});

// After OTLP Forwarder: local endpoint, no sidecar needed
new OTLPTraceExporter({ url: "http://localhost:4318/v1/traces" });
```

### W3C Context Propagation — Solves the invocation 2+ gap

If the Lambda platform adds native W3C propagation, the plugin would read `traceparent` from a standard env var or context field on every invocation — no backend-specific fix needed.

---

## Summary

| Lambda Platform Feature         | Impact on Durable Executions             | Plugin changes needed                                     |
| ------------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| OTLP Forwarder                  | Simpler exporter setup — no ADOT sidecar | None                                                      |
| W3C propagation                 | Solves invocation 2+ gap natively        | Minor: read new propagation source in `onInvocationStart` |
| Cold start reduction            | Lower plugin initialization overhead     | None                                                      |
| 3P egress (Telemetry Pipelines) | Simpler 3P backend configuration         | None                                                      |
