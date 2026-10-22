import { Event, EventType } from "@aws-sdk/client-lambda";
import { assertEventSignatures } from "../utils/test-helper";
import timeoutHistory from "../examples/wait-for-callback/basic/wait-for-callback-timed-out.history.json";

const history = timeoutHistory as unknown as Event[];
const completions = history.filter(
  (event) => event.EventType === EventType.InvocationCompleted,
);
const withInvocationCount = (count: number): Event[] => [
  ...history.filter(
    (event) => event.EventType !== EventType.InvocationCompleted,
  ),
  ...Array.from({ length: count }, (_, index) =>
    index === count - 1 ? completions[1]! : completions[0]!,
  ),
];
const cloudTimeoutConfig = { invocationCompletedCounts: [1, 2] };

describe("event signature invocation alternatives", () => {
  it.each([1, 2])("accepts the cloud timeout's %s-invocation path", (count) => {
    expect(() =>
      assertEventSignatures(
        withInvocationCount(count),
        history,
        false,
        cloudTimeoutConfig,
      ),
    ).not.toThrow();
  });

  it.each([0, 3])("rejects %s invocations for the cloud timeout", (count) => {
    expect(() =>
      assertEventSignatures(
        withInvocationCount(count),
        history,
        false,
        cloudTimeoutConfig,
      ),
    ).toThrow();
  });

  it("retains exact fixture counts without an explicit alternative", () => {
    expect(() =>
      assertEventSignatures(withInvocationCount(1), history),
    ).toThrow();
    expect(() =>
      assertEventSignatures(withInvocationCount(2), history),
    ).not.toThrow();
    expect(() =>
      assertEventSignatures(withInvocationCount(3), history),
    ).toThrow();
  });

  it.each([
    EventType.CallbackTimedOut,
    EventType.ContextFailed,
    EventType.StepStarted,
    EventType.StepSucceeded,
  ])("still rejects a missing %s event", (missingType) => {
    const missingEvent = withInvocationCount(1).filter(
      (event) => event.EventType !== missingType,
    );
    expect(() =>
      assertEventSignatures(missingEvent, history, false, cloudTimeoutConfig),
    ).toThrow();
  });
});
