import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { unwrapEvent } = require("../integration-dispatch.cjs") as {
  unwrapEvent: (event: unknown) => { example: string; event: any };
};

const durableEvent = (inputPayload?: string) => ({
  DurableExecutionArn: "arn",
  CheckpointToken: "token",
  InitialExecutionState: {
    Operations: [
      {
        Id: "execution",
        Type: "EXECUTION",
        ExecutionDetails: { InputPayload: inputPayload },
      },
    ],
  },
});

describe("integration-dispatch", () => {
  test("puts the original payload back into a durable event", () => {
    const { example, event } = unwrapEvent(
      durableEvent(
        JSON.stringify({ __example: "map-basic", __payload: { items: [1] } }),
      ),
    );

    expect(example).toBe("map-basic");
    expect(
      event.InitialExecutionState.Operations[0].ExecutionDetails.InputPayload,
    ).toBe('{"items":[1]}');
  });

  test("leaves no InputPayload when the test sent no payload", () => {
    const { event } = unwrapEvent(
      durableEvent(JSON.stringify({ __example: "hello-world" })),
    );

    expect(
      event.InitialExecutionState.Operations[0].ExecutionDetails.InputPayload,
    ).toBeUndefined();
  });

  test("returns the payload as the event of a non-durable function", () => {
    const { example, event } = unwrapEvent({
      __example: "non-durable",
      __payload: { failure: false },
    });

    expect(example).toBe("non-durable");
    expect(event).toEqual({ failure: false });
  });

  test.each([
    ["no example name", { __payload: {} }],
    ["a path in the example name", { __example: "../x" }],
  ])("fails on %s", (_, payload) => {
    expect(() => unwrapEvent(durableEvent(JSON.stringify(payload)))).toThrow(
      /needs \{ __example, __payload \}/,
    );
  });
});
