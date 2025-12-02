import {
  Event,
  EventType,
  ExecutionStatus,
  GetDurableExecutionHistoryCommandOutput,
} from "@aws-sdk/client-lambda";
import {
  HistoryPoller,
  HistoryPollerParams,
  HistoryApiClient,
  ReceivedOperationEventsCallback,
} from "../../../cloud/history-poller";
import { TestExecutionState } from "../../../common/test-execution-state";

// Test helper utilities
interface CreateHistoryPollerOptions {
  pollInterval?: number;
  durableExecutionArn?: string;
  historyResponses?: GetDurableExecutionHistoryCommandOutput[];
  historyError?: Error;
  onOperationEventsReceived?: ReceivedOperationEventsCallback;
}

function createMockEvent(overrides: Partial<Event> = {}): Event {
  const eventType = overrides.EventType ?? EventType.ExecutionStarted;
  const baseEvent: Event = {
    EventTimestamp: new Date(),
    EventType: eventType,
    EventId: 1,
    Id: "test-event-id",
    ...overrides,
  };

  // Add required detail fields based on event type
  if (eventType === EventType.ExecutionStarted) {
    baseEvent.ExecutionStartedDetails = {
      Input: {},
      ExecutionTimeout: undefined,
    };
  } else if (eventType === EventType.StepStarted) {
    baseEvent.StepStartedDetails = {
      Name: "test-step",
      Input: "{}",
      ...(overrides.StepStartedDetails ?? {}),
    };
  } else if (eventType === EventType.StepSucceeded) {
    baseEvent.StepSucceededDetails = {
      Result: { Payload: '{"success": true}' },
      RetryDetails: {},
      ...(overrides.StepSucceededDetails ?? {}),
    };
  }

  return baseEvent;
}

function createMockHistoryResponse(
  overrides: Partial<GetDurableExecutionHistoryCommandOutput> = {},
  includeSuccessEvent = true,
): GetDurableExecutionHistoryCommandOutput {
  const successEvent = createMockEvent({
    EventType: EventType.ExecutionSucceeded,
    ExecutionSucceededDetails: {
      Result: {
        Payload: "",
      },
    },
  });
  if (includeSuccessEvent) {
    overrides.Events?.push(successEvent);
  }
  return {
    Events: [createMockEvent()].concat(includeSuccessEvent ? successEvent : []),
    $metadata: {},
    ...overrides,
  };
}

function createHistoryPoller(options: CreateHistoryPollerOptions = {}): {
  poller: HistoryPoller;
  mockApiClient: jest.Mocked<HistoryApiClient>;
  testExecutionState: TestExecutionState;
  onOperationEventsReceived: jest.MockedFunction<ReceivedOperationEventsCallback>;
} {
  const testExecutionState = new TestExecutionState();

  // Create an unhandled promise by default which may create an unhandled rejection if something breaks
  void testExecutionState.createExecutionPromise();

  const onOperationEventsReceived = jest.fn();

  // Create simple Jest mocks for the API client
  let historyCallCount = 0;

  const mockApiClient: jest.Mocked<HistoryApiClient> = {
    getHistory: jest.fn().mockImplementation(() => {
      if (options.historyError) {
        return Promise.reject(options.historyError);
      }
      const responses = options.historyResponses ?? [
        createMockHistoryResponse(),
      ];
      const response =
        responses[historyCallCount] ?? responses[responses.length - 1];
      historyCallCount++;
      return Promise.resolve(response);
    }),
  };

  const params: HistoryPollerParams = {
    pollInterval: options.pollInterval ?? 100,
    durableExecutionArn: options.durableExecutionArn ?? "test-arn",
    testExecutionState,
    apiClient: mockApiClient,
    onOperationEventsReceived:
      options.onOperationEventsReceived ?? onOperationEventsReceived,
  };

  const poller = new HistoryPoller(params);

  return {
    poller,
    mockApiClient,
    testExecutionState,
    onOperationEventsReceived,
  };
}

async function waitForPollerCycles(
  cycles: number,
  pollInterval = 100,
): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await jest.advanceTimersByTimeAsync(pollInterval);
  }
}

describe("HistoryPoller", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("startPolling", () => {
    it("should start polling process", () => {
      const { poller } = createHistoryPoller();

      expect(() => {
        poller.startPolling();
      }).not.toThrow();
    });

    it("should throw error if already started", () => {
      const { poller } = createHistoryPoller();

      poller.startPolling();

      expect(() => {
        poller.startPolling();
      }).toThrow("Poller already started");
    });

    it("should begin polling after pollInterval", async () => {
      const { poller, mockApiClient } = createHistoryPoller({
        pollInterval: 200,
      });

      poller.startPolling();

      expect(mockApiClient.getHistory).not.toHaveBeenCalled();

      await waitForPollerCycles(1, 200);

      expect(mockApiClient.getHistory).toHaveBeenCalled();
    });
  });

  describe("stopPolling", () => {
    it("should stop polling process", async () => {
      const { poller, mockApiClient } = createHistoryPoller();

      poller.startPolling();
      await jest.advanceTimersByTimeAsync(100);

      const initialHistoryCalls = mockApiClient.getHistory.mock.calls.length;

      poller.stopPolling();
      await jest.advanceTimersByTimeAsync(200);

      expect(mockApiClient.getHistory).toHaveBeenCalledTimes(
        initialHistoryCalls,
      );
    });

    it("should handle multiple stop calls gracefully", () => {
      const { poller } = createHistoryPoller();

      poller.startPolling();
      poller.stopPolling();

      expect(() => {
        poller.stopPolling();
      }).not.toThrow();
    });

    it("should handle stop call without start", () => {
      const { poller } = createHistoryPoller();

      expect(() => {
        poller.stopPolling();
      }).not.toThrow();
    });
  });

  describe("getEvents", () => {
    it("should return events after successful execution", async () => {
      const testEvent = createMockEvent({ Id: "test-event" });
      const { poller } = createHistoryPoller({
        historyResponses: [createMockHistoryResponse({ Events: [testEvent] })],
      });

      poller.startPolling();
      await waitForPollerCycles(1);

      expect(poller.getEvents()).toContainEqual(testEvent);
    });

    it("should not add events for running executions", async () => {
      const testEvent = createMockEvent({ Id: "test-event" });
      const { poller } = createHistoryPoller({
        historyResponses: [
          createMockHistoryResponse({ Events: [testEvent] }, false),
        ],
      });

      poller.startPolling();
      await waitForPollerCycles(1);

      expect(poller.getEvents()).toEqual([]);
    });

    it("should accumulate events across multiple successful polls", async () => {
      const event1 = createMockEvent({ Id: "event-1" });
      const event2 = createMockEvent({ Id: "event-2" });

      const { poller } = createHistoryPoller({
        historyResponses: [
          createMockHistoryResponse({ Events: [event1] }, false),
          createMockHistoryResponse({ Events: [event2] }),
        ],
      });

      poller.startPolling();
      await waitForPollerCycles(2);

      const events = poller.getEvents();
      expect(events).toContainEqual(event2);
      expect(events).toHaveLength(2); // Only the last batch when execution completes
    });
  });

  describe("Event processing", () => {
    it("should call onOperationEventsReceived callback with processed events", async () => {
      const testEvent = createMockEvent({ Id: "test-event" });
      const { poller, onOperationEventsReceived } = createHistoryPoller({
        historyResponses: [createMockHistoryResponse({ Events: [testEvent] })],
      });

      poller.startPolling();
      await waitForPollerCycles(1);

      expect(onOperationEventsReceived).toHaveBeenCalledWith(expect.any(Array));
      expect(onOperationEventsReceived).toHaveBeenCalledTimes(1);
    });

    it("should process empty events array", async () => {
      const { poller, onOperationEventsReceived } = createHistoryPoller({
        historyResponses: [createMockHistoryResponse({ Events: [] })],
      });

      poller.startPolling();
      await waitForPollerCycles(1);

      expect(onOperationEventsReceived).toHaveBeenCalledWith(expect.any(Array));
    });

    it("should process undefined events array", async () => {
      const { poller, onOperationEventsReceived } = createHistoryPoller({
        historyResponses: [createMockHistoryResponse({ Events: undefined })],
      });

      poller.startPolling();
      await waitForPollerCycles(1);

      expect(onOperationEventsReceived).toHaveBeenCalledWith(expect.any(Array));
    });
  });

  describe("History pagination", () => {
    it("should handle NextMarker pagination", async () => {
      const event1 = createMockEvent({ Id: "event-1" });
      const event2 = createMockEvent({ Id: "event-2" });

      const { poller, mockApiClient } = createHistoryPoller({
        pollInterval: 100,
        historyResponses: [
          createMockHistoryResponse({
            Events: [event1],
            NextMarker: "page-2-marker",
          }),
          createMockHistoryResponse({
            Events: [event2],
            NextMarker: undefined,
          }),
        ],
      });

      poller.startPolling();
      // First cycle starts the polling
      await jest.advanceTimersByTimeAsync(100);
      // Wait for pagination delay between pages
      await jest.advanceTimersByTimeAsync(100);

      expect(mockApiClient.getHistory).toHaveBeenCalledTimes(2);
    });

    it("should process all events from paginated history", async () => {
      const event1 = createMockEvent({
        Id: "event-1",
        EventType: EventType.StepStarted,
      });
      const event2 = createMockEvent({
        Id: "event-2",
        EventType: EventType.StepStarted,
      });

      const { poller, onOperationEventsReceived } = createHistoryPoller({
        pollInterval: 100,
        historyResponses: [
          createMockHistoryResponse({
            Events: [event1],
            NextMarker: "marker",
          }),
          createMockHistoryResponse({
            Events: [event2],
            NextMarker: undefined,
          }),
        ],
      });

      poller.startPolling();
      // Wait for initial polling delay
      await jest.advanceTimersByTimeAsync(100);
      // Wait for pagination delay
      await jest.advanceTimersByTimeAsync(100);

      expect(onOperationEventsReceived).toHaveBeenCalledWith(expect.any(Array));
      const callArgs = onOperationEventsReceived.mock.calls[0][0];
      expect(callArgs.length).toBeGreaterThan(0);
    });
  });

  describe("Execution completion handling", () => {
    it("should resolve test execution state on successful completion", async () => {
      const { poller, testExecutionState } = createHistoryPoller({
        historyResponses: [
          createMockHistoryResponse(
            {
              Events: [
                createMockEvent({
                  EventType: EventType.ExecutionSucceeded,
                  ExecutionSucceededDetails: {
                    Result: {
                      Payload: '{"result": "success"}',
                    },
                  },
                }),
              ],
            },
            false,
          ),
        ],
      });

      const executionPromise = testExecutionState.createExecutionPromise();

      poller.startPolling();
      await waitForPollerCycles(1);

      const result = await executionPromise;
      expect(result).toEqual({
        status: ExecutionStatus.SUCCEEDED,
        result: '{"result": "success"}',
      });
    });

    it("should resolve test execution state on failed completion", async () => {
      const mockError = {
        ErrorMessage: "Execution failed",
        ErrorType: "TestError",
      };

      const { poller, testExecutionState } = createHistoryPoller({
        historyResponses: [
          createMockHistoryResponse(
            {
              Events: [
                createMockEvent({
                  EventType: EventType.ExecutionFailed,
                  ExecutionFailedDetails: {
                    Error: {
                      Payload: {
                        ErrorMessage: "Execution failed",
                        ErrorType: "TestError",
                      },
                    },
                  },
                }),
              ],
            },
            false,
          ),
        ],
      });

      const executionPromise = testExecutionState.createExecutionPromise();

      poller.startPolling();
      await waitForPollerCycles(1);

      const result = await executionPromise;
      expect(result).toEqual({
        status: ExecutionStatus.FAILED,
        error: mockError,
      });
    });

    it("should stop polling after execution completion", async () => {
      const { poller, mockApiClient } = createHistoryPoller({});

      poller.startPolling();
      await waitForPollerCycles(1);

      const callsAfterCompletion = mockApiClient.getHistory.mock.calls.length;

      await waitForPollerCycles(2);

      expect(mockApiClient.getHistory).toHaveBeenCalledTimes(
        callsAfterCompletion,
      );
    });

    it("should continue polling for running executions", async () => {
      const { poller, mockApiClient } = createHistoryPoller({
        historyResponses: [
          createMockHistoryResponse(undefined, false),
          createMockHistoryResponse(undefined, false),
          createMockHistoryResponse(undefined, true),
        ],
      });

      poller.startPolling();
      await waitForPollerCycles(3);

      expect(mockApiClient.getHistory).toHaveBeenCalledTimes(3);
    });
  });

  describe("Error handling", () => {
    it("should reject test execution state on history API error", async () => {
      const testError = new Error("History API failed");
      const { poller, testExecutionState, mockApiClient } = createHistoryPoller(
        {
          historyError: testError,
          historyResponses: [],
        },
      );

      const executionPromise = testExecutionState.createExecutionPromise();

      poller.startPolling();

      jest.advanceTimersByTime(100);

      await Promise.all([
        jest.advanceTimersByTimeAsync(30000),
        expect(executionPromise).rejects.toThrow("History API failed"),
      ]);
      expect(mockApiClient.getHistory).toHaveBeenCalledTimes(
        HistoryPoller.getMaxRetryAttempts(),
      );
    });

    it("should reject test execution state on execution API error", async () => {
      const testError = new Error("Execution API failed");
      const { poller, testExecutionState, mockApiClient } = createHistoryPoller(
        {
          historyError: testError,
        },
      );

      const executionPromise = testExecutionState.createExecutionPromise();

      poller.startPolling();

      jest.advanceTimersByTime(100);

      await Promise.all([
        jest.advanceTimersByTimeAsync(30000),
        expect(executionPromise).rejects.toThrow("Execution API failed"),
      ]);
      expect(mockApiClient.getHistory).toHaveBeenCalledTimes(
        HistoryPoller.getMaxRetryAttempts(),
      );
    });
  });

  describe("API client parameter validation", () => {
    it("should pass correct parameters to getHistory", async () => {
      const { poller, mockApiClient } = createHistoryPoller({
        durableExecutionArn: "test-execution-arn",
      });

      poller.startPolling();
      await waitForPollerCycles(1);

      expect(mockApiClient.getHistory).toHaveBeenCalledWith({
        DurableExecutionArn: "test-execution-arn",
        IncludeExecutionData: true,
        MaxItems: 1000,
        Marker: undefined,
      });
    });

    it("should pass marker from previous history response", async () => {
      const { poller, mockApiClient } = createHistoryPoller({
        durableExecutionArn: "test-execution-arn",
        pollInterval: 100,
        historyResponses: [
          createMockHistoryResponse({ NextMarker: "test-marker" }),
          createMockHistoryResponse({ NextMarker: undefined }),
        ],
      });

      poller.startPolling();
      // Wait for initial polling delay
      await jest.advanceTimersByTimeAsync(100);
      // Wait for pagination delay
      await jest.advanceTimersByTimeAsync(100);

      expect(mockApiClient.getHistory).toHaveBeenCalledTimes(2);
      expect(mockApiClient.getHistory).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          Marker: undefined,
        }),
      );
      expect(mockApiClient.getHistory).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          Marker: "test-marker",
        }),
      );
    });
  });

  describe("Polling behavior", () => {
    it("should persist history marker across polling cycles for running executions", async () => {
      const { poller, mockApiClient } = createHistoryPoller({
        pollInterval: 100,
        historyResponses: [
          // First poll: return history with NextMarker but no pagination
          createMockHistoryResponse(
            {
              Events: [createMockEvent({ Id: "event-1" })],
              NextMarker: undefined, // No pagination in this poll
            },
            false,
          ),
          // Second poll: should use marker from first poll
          createMockHistoryResponse({
            Events: [createMockEvent({ Id: "event-2" })],
            NextMarker: undefined,
          }),
        ],
      });

      // Override the first history response to return a NextMarker
      // to simulate having more pages available but execution still running
      let firstCall = true;
      mockApiClient.getHistory.mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          return Promise.resolve(
            createMockHistoryResponse(
              {
                Events: [createMockEvent({ Id: "event-1" })],
                NextMarker: "persistent-marker", // This should persist to next polling cycle
              },
              false,
            ),
          );
        } else {
          return Promise.resolve(
            createMockHistoryResponse({
              Events: [createMockEvent({ Id: "event-2" })],
              NextMarker: undefined,
            }),
          );
        }
      });

      poller.startPolling();

      // First polling cycle
      await waitForPollerCycles(1, 100);

      // Second polling cycle should use the marker from first cycle
      await waitForPollerCycles(1, 100);

      expect(mockApiClient.getHistory).toHaveBeenCalledTimes(2);

      // First call starts with no marker
      expect(mockApiClient.getHistory).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ Marker: undefined }),
      );

      // Second call should use the marker from first polling cycle
      expect(mockApiClient.getHistory).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ Marker: "persistent-marker" }),
      );
    });

    it("should not overlap polling cycles when API calls are slow", async () => {
      const getHistoryCallTimes: number[] = [];

      const { poller, mockApiClient } = createHistoryPoller({
        pollInterval: 100, // Short poll interval
      });

      // Mock API calls to have delays longer than poll interval
      mockApiClient.getHistory.mockImplementation(() => {
        getHistoryCallTimes.push(Date.now());
        // Simulate slow API call (300ms > 100ms poll interval)
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(
              createMockHistoryResponse(
                undefined,
                getHistoryCallTimes.length >= 3,
              ),
            );
          }, 300);
        });
      });

      poller.startPolling();

      // Advance through multiple polling cycles
      // First poll starts at 100ms
      await jest.advanceTimersByTimeAsync(100);
      // API call takes 300ms, so it completes at 400ms
      await jest.advanceTimersByTimeAsync(300);
      // Next poll should only start after the previous completes
      // Second poll starts at 400ms + poll interval = 500ms
      await jest.advanceTimersByTimeAsync(100);
      // Second poll completes, execution becomes SUCCEEDED, so polling stops
      await jest.advanceTimersByTimeAsync(300);

      // Verify calls happened sequentially, not overlapping
      // Should be 2 calls since execution completes after second check
      expect(mockApiClient.getHistory).toHaveBeenCalledTimes(2);

      // Verify timing: second call should start after the first completes
      // (300ms API delay + poll interval between calls)
      expect(getHistoryCallTimes.length).toBe(2);
      const timeBetweenCalls = getHistoryCallTimes[1] - getHistoryCallTimes[0];
      expect(timeBetweenCalls).toBeGreaterThan(300); // Should wait for previous to complete
    });
  });

  describe("Multi-page event handling", () => {
    it("should immediately store all pages except last during running execution", async () => {
      const page1Events = [
        createMockEvent({
          Id: "page1-event1",
          EventType: EventType.StepStarted,
        }),
        createMockEvent({
          Id: "page1-event2",
          EventType: EventType.StepStarted,
        }),
      ];
      const page2Events = [
        createMockEvent({
          Id: "page2-event1",
          EventType: EventType.StepStarted,
        }),
      ];
      const page3Events = [
        createMockEvent({
          Id: "page3-event1",
          EventType: EventType.StepStarted,
        }),
      ];

      const { poller } = createHistoryPoller({
        pollInterval: 100,
        historyResponses: [
          // First page
          createMockHistoryResponse(
            {
              Events: page1Events,
              NextMarker: "marker-page2",
            },
            false,
          ),
          // Second page
          createMockHistoryResponse(
            {
              Events: page2Events,
              NextMarker: "marker-page3",
            },
            false,
          ),
          // Last page
          createMockHistoryResponse(
            {
              Events: page3Events,
              NextMarker: undefined,
            },
            false,
          ),
        ],
      });

      poller.startPolling();
      // Wait for first polling cycle with multiple pages
      await jest.advanceTimersByTimeAsync(100); // Start poll
      await jest.advanceTimersByTimeAsync(100); // Page 1->2 delay
      await jest.advanceTimersByTimeAsync(100); // Page 2->3 delay

      // Should have added pages 1-2 immediately, but NOT page 3 (last page)
      const eventsAfterFirstPoll = poller.getEvents();
      expect(eventsAfterFirstPoll).toEqual([...page1Events, ...page2Events]);
      expect(eventsAfterFirstPoll).not.toContain(
        expect.objectContaining({ Id: "page3-event1" }),
      );
    });

    it("should add last page when execution completes, including new events added to that page", async () => {
      const page1Events = [
        createMockEvent({
          Id: "page1-event1",
          EventType: EventType.StepStarted,
        }),
      ];
      const page2Events = [
        createMockEvent({
          Id: "page2-event1",
          EventType: EventType.StepStarted,
        }),
      ];
      const page3OriginalEvents = [
        createMockEvent({
          Id: "page3-event1",
          EventType: EventType.StepStarted,
        }),
      ];
      // Simulate new events being added to the last page while execution was running
      const page3WithNewEvents = [
        ...page3OriginalEvents,
        createMockEvent({
          Id: "page3-event2",
          EventType: EventType.StepStarted,
        }),
        createMockEvent({
          Id: "page3-event3",
          EventType: EventType.StepSucceeded,
        }),
      ];

      const { poller } = createHistoryPoller({
        pollInterval: 100,
        historyResponses: [
          // First polling cycle - 3 pages, execution running
          createMockHistoryResponse(
            {
              Events: page1Events,
              NextMarker: "marker-page2",
            },
            false,
          ),
          createMockHistoryResponse(
            {
              Events: page2Events,
              NextMarker: "marker-page3",
            },
            false,
          ),
          createMockHistoryResponse(
            {
              Events: page3OriginalEvents,
              NextMarker: undefined,
            },
            false,
          ),
          // Second polling cycle - re-fetch from marker-page3, now with additional events
          createMockHistoryResponse({
            Events: page3WithNewEvents,
            NextMarker: undefined,
          }),
        ],
      });

      poller.startPolling();

      // First polling cycle - multiple pages, execution running
      await jest.advanceTimersByTimeAsync(100); // Start poll
      await jest.advanceTimersByTimeAsync(100); // Page 1->2 delay
      await jest.advanceTimersByTimeAsync(100); // Page 2->3 delay

      // After first cycle: should have pages 1-2 but NOT page 3 (last page is held back)
      const eventsAfterFirstPoll = poller.getEvents();
      expect(eventsAfterFirstPoll).toEqual([...page1Events, ...page2Events]);
      expect(eventsAfterFirstPoll).not.toContainEqual(
        expect.objectContaining({ Id: "page3-event1" }),
      );

      // Second polling cycle - execution completes, re-fetches the last page with new events
      await jest.advanceTimersByTimeAsync(100); // Next poll starts

      // After completion: should have early pages + the re-fetched last page with new events
      const finalEvents = poller.getEvents();

      expect(finalEvents).toEqual([
        ...page1Events,
        ...page2Events,
        ...page3WithNewEvents, // Re-fetched last page now includes original + new events
      ]);

      // Verify we have both original and new events from the last page
      expect(finalEvents).toContainEqual(
        expect.objectContaining({ Id: "page3-event1" }),
      ); // Original
      expect(finalEvents).toContainEqual(
        expect.objectContaining({ Id: "page3-event2" }),
      ); // New
      expect(finalEvents).toContainEqual(
        expect.objectContaining({ Id: "page3-event3" }),
      ); // New

      // Total: 2 from early pages + 3 from re-fetched last page = 5 events + 1 from succeeded event
      expect(finalEvents).toHaveLength(6);
    });

    it("should handle single page correctly during running execution", async () => {
      const singlePageEvents = [
        createMockEvent({
          Id: "single-event",
          EventType: EventType.StepStarted,
        }),
      ];

      const { poller } = createHistoryPoller({
        historyResponses: [
          createMockHistoryResponse(
            {
              Events: singlePageEvents,
              NextMarker: undefined,
            },
            false,
          ),
        ],
      });

      poller.startPolling();
      await waitForPollerCycles(1);

      // With single page during running execution, no events should be stored yet
      // (since the single page is the "last page")
      expect(poller.getEvents()).toEqual([]);
    });
  });

  describe("Integration scenarios", () => {
    it("should handle complete polling lifecycle", async () => {
      const events = [
        createMockEvent({
          Id: "event-1",
          EventType: EventType.ExecutionStarted,
        }),
        createMockEvent({ Id: "event-2", EventType: EventType.StepStarted }),
        createMockEvent({ Id: "event-3", EventType: EventType.StepSucceeded }),
        createMockEvent({
          Id: "event-4",
          EventType: EventType.ExecutionSucceeded,
          ExecutionSucceededDetails: {
            Result: {
              Payload: '{"completed": true}',
            },
          },
        }),
      ];

      const { poller, testExecutionState, onOperationEventsReceived } =
        createHistoryPoller({
          pollInterval: 50,
          historyResponses: [
            createMockHistoryResponse({ Events: events }, false),
          ],
        });

      const executionPromise = testExecutionState.createExecutionPromise();

      poller.startPolling();
      await waitForPollerCycles(1, 50);

      // Verify events were processed
      expect(onOperationEventsReceived).toHaveBeenCalledWith(expect.any(Array));

      // Verify execution completed
      const result = await executionPromise;
      expect(result.status).toBe(ExecutionStatus.SUCCEEDED);
      expect(result.result).toBe('{"completed": true}');

      // Verify events were stored
      expect(poller.getEvents()).toEqual(events);
    });

    it("should handle restart after stop", () => {
      const { poller } = createHistoryPoller();

      poller.startPolling();
      poller.stopPolling();

      expect(() => {
        poller.startPolling();
      }).not.toThrow();
    });

    it("should handle multiple rapid start/stop cycles", () => {
      const { poller } = createHistoryPoller();

      for (let i = 0; i < 5; i++) {
        poller.startPolling();
        poller.stopPolling();
      }

      expect(() => {
        poller.startPolling();
      }).not.toThrow();
    });
  });
});
