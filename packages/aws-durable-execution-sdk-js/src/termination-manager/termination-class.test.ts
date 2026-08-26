import {
  TERMINATION_CLASS,
  TerminationReason,
  classifyTermination,
} from "./types";

describe("termination reason classification", () => {
  it("classifies every reason in the enum", () => {
    // The compiler already enforces this -- TERMINATION_CLASS is a
    // Record<TerminationReason, ...>, so an unclassified reason fails to build. Asserted
    // at runtime too because the enum is what the service and the SDK agree on, and a
    // reason silently dropped from the map by a bad merge would otherwise fall to the
    // "fault" default and quietly fail executions that were only suspending.
    for (const reason of Object.values(TerminationReason)) {
      expect(TERMINATION_CLASS[reason]).toBeDefined();
    }
    expect(Object.keys(TERMINATION_CLASS).sort()).toEqual(
      Object.values(TerminationReason).sort(),
    );
  });

  it.each([
    TerminationReason.OPERATION_TERMINATED,
    TerminationReason.WAIT_SCHEDULED,
    TerminationReason.RETRY_SCHEDULED,
    TerminationReason.RETRY_INTERRUPTED_STEP,
    TerminationReason.CALLBACK_PENDING,
  ])("treats %s as a suspend", (reason) => {
    expect(classifyTermination(reason)).toBe("suspend");
  });

  it.each([
    TerminationReason.CHECKPOINT_FAILED,
    TerminationReason.SERDES_FAILED,
    TerminationReason.CONTEXT_VALIDATION_ERROR,
    TerminationReason.CONFIG_VALIDATION_ERROR,
    TerminationReason.NON_DETERMINISM,
    TerminationReason.CUSTOM,
  ])("treats %s as a fault", (reason) => {
    expect(classifyTermination(reason)).toBe("fault");
  });

  it("defaults to fault for a reason outside the enum", () => {
    // Not reachable through the enum, but the value crosses a boundary where a plain
    // string can arrive. Answering "suspend" for something unrecognised is the outcome
    // being ruled out: it would report an execution as still progressing when nothing
    // is pending.
    expect(classifyTermination("SOMETHING_NEW" as TerminationReason)).toBe(
      "fault",
    );
  });
});
