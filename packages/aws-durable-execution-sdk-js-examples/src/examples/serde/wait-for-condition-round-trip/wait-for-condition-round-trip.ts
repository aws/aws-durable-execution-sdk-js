import {
  DurableContext,
  Serdes,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Wait for Condition Serdes Round Trip",
  description:
    "Uses a non-identity serdes to show that waitForCondition passes a " +
    "round-tripped initialState to the first check, and returns the " +
    "checkpointed state on the first run even when waitStrategy mutates it. " +
    "The first-run result therefore equals the result a replay returns.",
};

interface PollState {
  polls: number;
  // One entry per check: whether that check received a round-tripped state.
  roundTrippedOnEachCheck: boolean[];
  // Added by markerSerdes.deserialize. Absent from every serialized payload.
  roundTripped?: boolean;
}

const POLLS_UNTIL_READY = 3;

/**
 * A serdes whose round-trip is observable.
 *
 * serialize omits the `roundTripped` property from the JSON payload.
 * deserialize parses the payload and sets `roundTripped: true`.
 * So deserialize(serialize(x)) differs from x whenever x lacks the marker.
 * So a state that carries `roundTripped: true` came from deserialize.
 */
const markerSerdes: Serdes<PollState> = {
  serialize: async (value) => {
    if (value === undefined) {
      return undefined;
    }
    const { roundTripped: _omitted, ...payload } = value;
    return JSON.stringify(payload);
  },
  deserialize: async (data) => {
    if (data === undefined) {
      return undefined;
    }
    return { ...(JSON.parse(data) as PollState), roundTripped: true };
  },
};

export const handler = withDurableExecution(
  async (_event: unknown, context: DurableContext) => {
    const finalState = await context.waitForCondition<PollState>(
      "poll-until-ready",
      async (state) => ({
        polls: state.polls + 1,
        roundTrippedOnEachCheck: [
          ...state.roundTrippedOnEachCheck,
          state.roundTripped === true,
        ],
      }),
      {
        initialState: { polls: 0, roundTrippedOnEachCheck: [] },
        serdes: markerSerdes,
        waitStrategy: (state) => {
          if (state.polls >= POLLS_UNTIL_READY) {
            // waitStrategy is user code and may mutate its argument. The SDK
            // returns the checkpointed state, so this mutation is not visible
            // in finalState.
            state.polls = -1;
            return { shouldContinue: false };
          }
          return { shouldContinue: true, delay: { seconds: 1 } };
        },
      },
    );

    // The step checkpoints the value waitForCondition returned on its first
    // run. A replay of the step returns that checkpointed value.
    const firstRunState = await context.step(
      "record-first-run-state",
      async () => finalState,
    );

    // The wait ends the invocation. The next invocation replays
    // waitForCondition from its SUCCEED checkpoint.
    await context.wait("force-replay", { seconds: 1 });

    return {
      finalState,
      firstRunState,
      firstRunMatchesReplay:
        JSON.stringify(firstRunState) === JSON.stringify(finalState),
    };
  },
);
