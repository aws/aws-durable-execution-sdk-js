// Match the SDK-owned opt-in protocol without a runtime import of the core SDK.
// A local symbol declaration also keeps old-core TypeScript consumers compatible.
export const PLUGIN_REGISTRATION = Symbol.for(
  "aws.lambda.durable.instrumentation.plugin-registration",
);
