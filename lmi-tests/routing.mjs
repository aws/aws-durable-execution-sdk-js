// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
export function routeExample(event, handlers) {
  const operations = event.InitialExecutionState.Operations;
  const root = operations.find((operation) => operation.Type === "EXECUTION");
  const envelope = JSON.parse(root.ExecutionDetails.InputPayload);
  if (!envelope || !Object.hasOwn(envelope, "__lmiExample")) return undefined;
  const metadata = envelope.__lmiExample;
  if (!Object.hasOwn(handlers, metadata.name))
    throw new Error("Unknown LMI example handler");
  // Routing stays in the checkpointed invocation input. Only the handler's view
  // is unwrapped; the real SDK consumes the original service checkpoints/history.
  const routed = {
    ...event,
    InitialExecutionState: {
      ...event.InitialExecutionState,
      Operations: operations.map((operation) =>
        operation === root
          ? {
              ...root,
              ExecutionDetails: {
                ...root.ExecutionDetails,
                InputPayload: JSON.stringify(envelope.input),
              },
            }
          : operation,
      ),
    },
  };
  return {
    handler: handlers[metadata.name],
    event: routed,
    metadata: {
      marker: metadata.marker,
      run: metadata.run,
      scenario: "example",
      example: metadata.name,
    },
  };
}
