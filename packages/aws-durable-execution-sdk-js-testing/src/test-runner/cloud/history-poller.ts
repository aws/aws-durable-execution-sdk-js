import {
  Event,
  GetDurableExecutionHistoryCommandOutput,
  GetDurableExecutionHistoryRequest,
} from "@aws-sdk/client-lambda";
import { OperationStatus } from "@aws/durable-execution-sdk-js";
import { OperationEvents } from "../common/operations/operation-with-data";
import { historyEventsToOperationEvents } from "./utils/process-history-events/process-history-events";
import { TestExecutionState } from "../common/test-execution-state";
import { isClosedExecution } from "./utils/process-terminal-event/process-terminal-event";
import {
  executionHistoryEventTypes,
  historyEventTypes,
} from "./utils/process-history-events/history-event-types";
import {
  getErrorFromEvent,
  getPayloadFromEvent,
} from "./utils/process-history-events/event-data-extractors";

export type ReceivedOperationEventsCallback = (
  operationEvents: OperationEvents[],
) => void;

export interface HistoryPollerParams {
  pollInterval: number;
  durableExecutionArn: string;

  testExecutionState: TestExecutionState;
  apiClient: HistoryApiClient;

  onOperationEventsReceived: ReceivedOperationEventsCallback;
}

export interface HistoryApiClient {
  getHistory: (
    request: GetDurableExecutionHistoryRequest,
  ) => Promise<GetDurableExecutionHistoryCommandOutput>;
}

/**
 * True when the events' IDs do not cover every number from 1 to the highest
 * ID. IDs may arrive out of order. Events without an ID skip the check, since
 * there is then nothing to count.
 */
export function hasEventIdGap(events: Event[]): boolean {
  const ids = new Set<number>();
  for (const event of events) {
    if (event.EventId === undefined) return false;
    ids.add(event.EventId);
  }
  let max = 0;
  for (const id of ids) max = Math.max(max, id);
  return ids.size < max;
}

export class HistoryPoller {
  private readonly events: Event[] = [];
  private readonly pollInterval: number;
  private readonly durableExecutionArn: string;

  private pollerTimeout: NodeJS.Timeout | undefined;
  private readonly testExecutionState: TestExecutionState;
  private readonly apiClient: HistoryApiClient;
  private readonly onOperationEventsReceived: ReceivedOperationEventsCallback;

  private lastHistoryMarker: string | undefined = undefined;
  private incompleteHistoryRetries = 0;

  constructor(params: HistoryPollerParams) {
    this.pollInterval = params.pollInterval;
    this.testExecutionState = params.testExecutionState;
    this.apiClient = params.apiClient;
    this.durableExecutionArn = params.durableExecutionArn;
    this.onOperationEventsReceived = params.onOperationEventsReceived;
  }

  private processEvents(events: Event[]) {
    const operationEvents = historyEventsToOperationEvents(events);
    this.onOperationEventsReceived(operationEvents);
  }

  getEvents(): Event[] {
    return this.events;
  }

  static getMaxRetryAttempts() {
    return 3;
  }

  /**
   * How many extra polls to make when a closed execution's history has a gap
   * in its event IDs. After that the poller resolves with what it has.
   */
  static getMaxIncompleteHistoryRetries() {
    return 10;
  }

  private async callWithRetries<Result>(
    fn: () => Promise<Result>,
  ): Promise<Promise<Result>> {
    let failedAttempts = 0;
    while (true) {
      try {
        return await fn();
      } catch (err: unknown) {
        failedAttempts++;
        if (failedAttempts >= HistoryPoller.getMaxRetryAttempts()) {
          throw err;
        }

        // Wait with exponential backoff
        await new Promise((resolve) =>
          setTimeout(resolve, (failedAttempts ** 2 - 1) * 150 + 1000),
        );
      }
    }
  }

  private async getExecutionData() {
    const pages: Event[][] = [];
    let currentHistoryMarker: string | undefined = this.lastHistoryMarker;
    let previousHistoryMarker: string | undefined;
    do {
      const historyResult = await this.callWithRetries(() =>
        this.apiClient.getHistory({
          DurableExecutionArn: this.durableExecutionArn,
          IncludeExecutionData: true,
          MaxItems: 1000,
          Marker: currentHistoryMarker,
        }),
      );
      previousHistoryMarker = currentHistoryMarker;
      currentHistoryMarker = historyResult.NextMarker;
      pages.push(historyResult.Events ?? []);

      if (historyResult.NextMarker) {
        // Add delay between each page to avoid throttling
        await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
      }
    } while (currentHistoryMarker);

    this.lastHistoryMarker = previousHistoryMarker;

    this.processEvents(pages.flat());

    const lastEvent = pages.at(-1)?.at(-1);
    const eventsExceptLastPage = pages.slice(0, -1).flat();

    if (!isClosedExecution(lastEvent)) {
      // If the execution has not completed, do not add the last page
      // since we will be reading the same page again.
      this.events.push(...eventsExceptLastPage);
      return;
    }

    const lastPage = pages.at(-1) ?? [];
    const allEvents = [...this.events, ...eventsExceptLastPage, ...lastPage];

    // The history API is eventually consistent. It can return the terminal
    // event while an earlier event is still missing, such as the final
    // InvocationCompleted or some map children. Event IDs count up from 1, so
    // a gap means the history is not complete yet. Read it again from the
    // start, up to a limit, rather than resolve with missing events.
    if (
      hasEventIdGap(allEvents) &&
      this.incompleteHistoryRetries < HistoryPoller.getMaxIncompleteHistoryRetries()
    ) {
      this.incompleteHistoryRetries++;
      this.events.length = 0;
      this.lastHistoryMarker = undefined;
      return;
    }

    this.events.push(...eventsExceptLastPage, ...lastPage);

    const historyEventType = historyEventTypes[
      lastEvent.EventType
    ] as (typeof executionHistoryEventTypes)[keyof typeof executionHistoryEventTypes];

    if (historyEventType.operationStatus === OperationStatus.STARTED) {
      throw new Error("Completed execution cannot have STARTED status");
    }

    this.testExecutionState.resolveWith({
      status: historyEventType.operationStatus,
      result: getPayloadFromEvent(lastEvent, historyEventType.detailPlace),
      error: getErrorFromEvent(lastEvent, historyEventType.detailPlace),
    });

    this.stopPolling();
  }

  private runPoller(): NodeJS.Timeout {
    return setTimeout(() => {
      this.getExecutionData()
        .then(() => {
          if (this.pollerTimeout === undefined) {
            // stopPolling was called, so return early
            return;
          }
          this.pollerTimeout = this.runPoller();
        })
        .catch((err: unknown) => {
          this.stopPolling();
          this.testExecutionState.rejectWith(err);
        });
    }, this.pollInterval);
  }

  startPolling() {
    if (this.pollerTimeout !== undefined) {
      throw new Error("Poller already started");
    }

    this.pollerTimeout = this.runPoller();
  }

  stopPolling() {
    clearTimeout(this.pollerTimeout);
    this.pollerTimeout = undefined;
  }
}
