import { Event, ErrorObject } from "@aws-sdk/client-lambda";
import {
  getErrorFromEvent,
  getPayloadFromEvent,
} from "../event-data-extractors";

describe("getErrorFromEvent", () => {
  it("should return error payload when error exists in details", () => {
    const errorPayload: ErrorObject = {
      ErrorType: "TestError",
      ErrorMessage: "Test error message",
      ErrorData: "error data",
      StackTrace: ["at test (test.js:1:1)"],
    };

    const event: Event = {
      StepFailedDetails: {
        Error: {
          Payload: errorPayload,
        },
      },
    };

    const result = getErrorFromEvent(event, "StepFailedDetails");
    expect(result).toEqual(errorPayload);
  });

  it("should return undefined when details don't exist", () => {
    const event: Event = {};

    const result = getErrorFromEvent(event, "StepFailedDetails");
    expect(result).toBeUndefined();
  });

  it("should return undefined when details exist but no error", () => {
    const event: Event = {
      StepSucceededDetails: {
        Result: {
          Payload: "success result",
        },
      },
    };

    const result = getErrorFromEvent(event, "StepSucceededDetails");
    expect(result).toBeUndefined();
  });

  it("should return undefined when error exists but no payload", () => {
    const event: Event = {
      StepFailedDetails: {
        Error: {},
      },
    };

    const result = getErrorFromEvent(event, "StepFailedDetails");
    expect(result).toBeUndefined();
  });

  it("should handle different detail places", () => {
    const errorPayload: ErrorObject = {
      ErrorType: "CallbackError",
      ErrorMessage: "Callback failed",
    };

    const event: Event = {
      CallbackFailedDetails: {
        Error: {
          Payload: errorPayload,
        },
      },
    };

    const result = getErrorFromEvent(event, "CallbackFailedDetails");
    expect(result).toEqual(errorPayload);
  });
});

describe("getPayloadFromEvent", () => {
  it("should return input payload when input exists in details", () => {
    const inputPayload = '{"key": "value"}';
    const event: Event = {
      StepStartedDetails: {
        Input: {
          Payload: inputPayload,
        },
      },
    };

    const result = getPayloadFromEvent(event, "StepStartedDetails");
    expect(result).toBe(inputPayload);
  });

  it("should return result payload when result exists in details", () => {
    const resultPayload = '{"result": "success"}';
    const event: Event = {
      StepSucceededDetails: {
        Result: {
          Payload: resultPayload,
        },
      },
    };

    const result = getPayloadFromEvent(event, "StepSucceededDetails");
    expect(result).toBe(resultPayload);
  });

  it("should return undefined when details don't exist", () => {
    const event: Event = {};

    const result = getPayloadFromEvent(event, "StepStartedDetails");
    expect(result).toBeUndefined();
  });

  it("should return undefined when details exist but no input or result", () => {
    const event: Event = {
      StepFailedDetails: {
        Error: {
          Payload: {
            ErrorType: "TestError",
            ErrorMessage: "Test error",
          },
        },
      },
    };

    const result = getPayloadFromEvent(event, "StepFailedDetails");
    expect(result).toBeUndefined();
  });

  it("should return undefined when input exists but no payload", () => {
    const event: Event = {
      StepStartedDetails: {
        Input: {},
      },
    };

    const result = getPayloadFromEvent(event, "StepStartedDetails");
    expect(result).toBeUndefined();
  });

  it("should return undefined when result exists but no payload", () => {
    const event: Event = {
      StepSucceededDetails: {
        Result: {},
      },
    };

    const result = getPayloadFromEvent(event, "StepSucceededDetails");
    expect(result).toBeUndefined();
  });

  it("should throw error when both input and result exist", () => {
    const inputPayload = '{"input": "data"}';
    const resultPayload = '{"result": "data"}';

    const event: Event = {
      StepStartedDetails: {
        Input: {
          Payload: inputPayload,
        },
        Result: {
          Payload: resultPayload,
        },
      },
    };

    expect(() => getPayloadFromEvent(event, "StepStartedDetails")).toThrow(
      "Event contains both Input and Result"
    );
  });

  it("should handle different detail places", () => {
    const payload = '{"callback": "data"}';
    const event: Event = {
      CallbackSucceededDetails: {
        Result: {
          Payload: payload,
        },
      },
    };

    const result = getPayloadFromEvent(event, "CallbackSucceededDetails");
    expect(result).toBe(payload);
  });

  it("should handle empty string payloads", () => {
    const event: Event = {
      StepStartedDetails: {
        Input: {
          Payload: "",
        },
      },
    };

    const result = getPayloadFromEvent(event, "StepStartedDetails");
    expect(result).toBe("");
  });
});
