import { handler } from "./map-early-completion-suspends";
import { createTests } from "../../../utils/test-helper";

createTests<number[]>({
  handler,
  tests: (runner, { assertEventSignatures }) => {
    it.each([
      ["default-serdes", false],
      ["slow-item-deserializer", true],
    ])(
      "%s: the wait after an early-completed map suspends",
      async (scenario, slowDeserialize) => {
        const execution = await runner.run({ payload: { slowDeserialize } });

        expect(execution.getStatus()).toBe("SUCCEEDED");
        expect(execution.getResult()).toEqual([0]);
        // The wait after the map suspended the first invocation. A step left
        // EXECUTING by a dropped checkpoint would block that, and the first
        // invocation would run on to the end.
        expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);

        // The assertion above already requires a suspension. The event
        // counts below allow one more invocation, because the service can
        // deliver the wait completion separately.
        assertEventSignatures(execution, scenario, {
          invocationCompletedDifference: 1,
        });
      },
    );
  },
});
