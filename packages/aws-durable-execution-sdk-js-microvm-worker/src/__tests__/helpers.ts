// Fakes and request helpers that the listener tests share. Jest runs only
// files named *.test.ts, so this file is not a suite.
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import {
  type LambdaMicrovmsClient,
  SuspendMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";
import type { MicrovmWorkerListener } from "..";

/** The headers of Lambda's own hook calls, as measured in us-east-1. */
export const LAMBDA_HEADERS: IncomingHttpHeaders = { host: "localhost:8080" };

/** The headers of a request that the MicroVM endpoint forwarded. */
export const FORWARDED_HEADERS: IncomingHttpHeaders = {
  host: "7ed0892b.lambda-microvm.us-east-1.on.aws",
  "x-amzn-requestid": "6f1c0e0a-0000-4000-8000-000000000000",
};

/**
 * Records SuspendMicrovm calls. `failure` answers every call with an error.
 * With `hold`, each call stays pending until `finish()`.
 */
export class FakeMicrovmsClient {
  readonly suspended: string[] = [];
  failure: Error | undefined;
  hold = false;
  /** The worker must never call it, because the test owns this client. */
  readonly destroy = jest.fn();
  private pending: (() => void) | undefined;

  async send(command: unknown): Promise<unknown> {
    if (!(command instanceof SuspendMicrovmCommand)) {
      throw new Error("unexpected command");
    }
    this.suspended.push(command.input.microvmIdentifier as string);
    if (this.hold) {
      await new Promise<void>((resolve) => {
        this.pending = resolve;
      });
    }
    if (this.failure) {
      throw this.failure;
    }
    return {};
  }

  /** Lets a held call return. */
  finish(): void {
    this.pending?.();
    this.pending = undefined;
  }

  asClient(): LambdaMicrovmsClient {
    return this as unknown as LambdaMicrovmsClient;
  }
}

/**
 * Sends one request to the listener, and resolves with the status. The
 * request carries Lambda's hook headers unless `headers` replaces them.
 */
export const call = (
  target: MicrovmWorkerListener,
  path: string,
  body: unknown,
  headers: IncomingHttpHeaders = LAMBDA_HEADERS,
): Promise<number> =>
  new Promise((resolve) => {
    const request = Object.assign(
      Readable.from([Buffer.from(JSON.stringify(body))]),
      { url: path, method: "POST", headers },
    );
    let status = 0;
    const response = {
      headersSent: false,
      writeHead(code: number) {
        status = code;
        this.headersSent = true;
        return this;
      },
      end() {
        resolve(status);
        return this;
      },
    };
    target.listener(
      request as unknown as IncomingMessage,
      response as unknown as ServerResponse,
    );
  });

/** Advances fake time, and lets the promises that it releases settle. */
export const advance = (ms: number): Promise<void> =>
  jest.advanceTimersByTimeAsync(ms);
