import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { LambdaClient } from "@aws-sdk/client-lambda";
import {
  CallbackReporter,
  ResultSerializationError,
  ResultTooLargeError,
} from "../callback-reporter";
import { parseJobRequest } from "../microvm/payload";
import { readJson, safeLogger, startHeartbeats } from "../microvm/worker";

/**
 * The request header in which AgentCore Runtime passes the runtime session
 * ID. Node.js gives header names in lower case, so the lookup ignores case.
 */
const SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id";

/**
 * The port that AgentCore Runtime sends requests to inside the container.
 *
 * @experimental This constant is experimental and may be changed or removed in future releases.
 */
export const AGENTCORE_PORT = 8080;

/** The largest job body that the worker reads. */
const MAX_JOB_BODY_BYTES = 6 * 1024 * 1024;

/**
 * How many callback IDs the worker remembers.
 *
 * InvokeAgentRuntime has no idempotency token. So the durable function's
 * request step can deliver the same job twice, for example after a lost
 * answer. Each callback ID belongs to one job. So the worker runs a callback
 * ID once. A callback ID is a short string, so 1,000 of them use well under
 * 1 MB.
 */
const MAX_REMEMBERED_JOBS = 1_000;

/**
 * The job document that the `agentcore` operation sends as the
 * InvokeAgentRuntime payload.
 *
 * @remarks
 * The same type is declared in
 * `@aws/durable-execution-sdk-js-extras/compute/agentcore`. The two
 * packages do not depend on each other, because one runs in the function
 * and the other in the agent runtime. So a change to one declaration must be
 * made in the other too.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AgentcoreJobDocument<TInput = unknown> {
  /** The document format version. */
  version: 1;
  /** The Region of the durable function, for the callback API calls. */
  region: string;
  /** The callback ID that the worker completes with the job's outcome. */
  callbackId: string;
  /** The heartbeat timeout in seconds, when the caller set one. */
  heartbeatTimeoutSeconds?: number;
  /**
   * The caller's input. The document has no `input` field when the input
   * encodes to no value, such as `undefined`.
   */
  input: TInput;
}

/**
 * The logger the worker writes to.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AgentcoreWorkerLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * What the job handler receives besides its input.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AgentcoreJobContext {
  /** The callback ID that the worker completes with the handler's result. */
  callbackId: string;
  /**
   * The AgentCore runtime session ID, from the
   * `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` request header.
   * `undefined` when the request had no such header.
   */
  sessionId?: string;
  /** The Region of the durable function. */
  region: string;
  /**
   * Aborted when a heartbeat finds that the durable function no longer
   * accepts the result, for example after a callback timeout. The handler
   * should then stop its work. This case fires only when the job has a
   * heartbeat timeout.
   */
  signal: AbortSignal;
  /** The worker's logger. */
  logger: AgentcoreWorkerLogger;
}

/**
 * The job to run. Its resolved value becomes the durable function's result.
 * A rejection fails the durable operation with the error's name and message.
 *
 * The handler runs on the event loop that also answers `/ping` and sends
 * heartbeats. Synchronous CPU work blocks both while it runs. So run
 * CPU-bound work in a worker thread or a child process.
 *
 * @public
 *
 * @experimental This type is experimental and may be changed or removed in future releases.
 */
export type AgentcoreJobHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: AgentcoreJobContext,
) => Promise<TOutput>;

/**
 * Options for {@link startAgentcoreWorker}.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AgentcoreWorkerOptions<TInput = unknown, TOutput = unknown> {
  /** The job to run for each job document. */
  handler: AgentcoreJobHandler<TInput, TOutput>;
  /**
   * Creates the Lambda client for a Region. Defaults to a client that uses
   * the default credential chain, which resolves the agent runtime's
   * execution role. Called for each job. The worker never destroys a client
   * that this function returns.
   */
  createClient?: (region: string) => LambdaClient;
  /**
   * Defaults to single-line JSON on stdout and stderr. The worker drops an
   * error that a logger method throws, and a rejection of a promise that it
   * returns.
   */
  logger?: AgentcoreWorkerLogger;
}

/**
 * A running worker server.
 *
 * @public
 *
 * @experimental This interface is experimental and may be changed or removed in future releases.
 */
export interface AgentcoreWorker {
  /** The port the server listens on. */
  port: number;
  /** Resolves when every job started so far has ended. */
  idle(): Promise<void>;
  /** Stops accepting connections. Running jobs continue. */
  close(): Promise<void>;
}

/**
 * Starts an HTTP server that implements the AgentCore Runtime service
 * contract for jobs from the `agentcore` operation.
 *
 * @remarks
 * The server answers two routes:
 *
 * - `GET /ping` answers `{"status": "HealthyBusy", "time_of_last_update":
 *   <seconds>}` while a job runs, and `"Healthy"` otherwise. AgentCore
 *   Runtime keeps a busy session alive past its idle timeout.
 *   `time_of_last_update` is the Unix time, in seconds, of the last status
 *   change. The worker sets it when it starts and when the status changes
 *   between `Healthy` and `HealthyBusy`. It does not set it to the current
 *   time on every ping, because the documentation asks to set it only on a
 *   change.
 * - `POST /invocations` reads the job document. It answers
 *   `{"accepted": true}` at once and runs `handler` in the background. A
 *   document that does not match the contract gets HTTP 400.
 *
 * A second delivery of a callback ID starts no job. It gets
 * `{"accepted": true}` again. The worker remembers the last 1,000 callback
 * IDs in memory. So a retried delivery runs a job once, unless at least
 * 1,000 other jobs arrived in between, or the worker process restarted. A
 * retry can reach a new process, for example after the agent runtime's idle
 * timeout replaced the old one. The new process does not know the callback
 * ID, so it runs the job again. So delivery is at least once, and the
 * handler's side effects must be idempotent.
 *
 * For each job, the worker sends heartbeats while the job runs, when the job
 * sets a heartbeat timeout. When the handler ends, the worker completes the
 * job's callback with the result, or fails it with the error.
 *
 * @param options - The worker options.
 * @param port - The port to listen on. Defaults to 8080, the port that
 * AgentCore Runtime requires.
 * @param host - The address to listen on. The default depends on where the
 * worker runs:
 *
 * 1. AgentCore Runtime requires the agent to listen on `0.0.0.0:8080`.
 *    Callers reach the port only through InvokeAgentRuntime, which signs
 *    each request with SigV4.
 * 2. `/invocations` itself has no authentication. On a laptop or a dev
 *    host, a bind on all interfaces lets any machine on the network send a
 *    job, which then runs with the developer's credentials.
 * 3. AgentCore Runtime sets the `AGENTCORE_RUNTIME_URL` environment
 *    variable, also for a direct code deployment, which has no container
 *    marker such as `/.dockerenv`.
 * 4. So the default is `0.0.0.0` when `AGENTCORE_RUNTIME_URL` is set, and
 *    `127.0.0.1` otherwise. An explicit `host` replaces the default.
 * @returns The running worker. The promise rejects when the port cannot be
 * bound.
 *
 * @public
 *
 * @experimental This function is experimental and may be changed or removed in future releases.
 */
export async function startAgentcoreWorker<TInput = unknown, TOutput = unknown>(
  options: AgentcoreWorkerOptions<TInput, TOutput>,
  port: number = AGENTCORE_PORT,
  host: string = defaultHost(),
): Promise<AgentcoreWorker> {
  // A logger call that throws, or that returns a rejected promise, would
  // end the process or skip the job's cleanup. So the worker wraps the
  // logger like the MicroVM worker does.
  const logger = safeLogger(options.logger ?? jsonLogger);
  const running = new Set<Promise<void>>();
  // Every callback ID that the worker accepted, oldest first. A Set keeps
  // insertion order.
  const accepted = new Set<string>();
  // The Unix time, in seconds, of the last status change. A public report
  // states that the service ends a HealthyBusy session at its idle timeout
  // when the ping answer has no time_of_last_update. The documentation makes
  // the field optional and asks to set it only when the status changes. So
  // the worker sets it at start, and when the status flips.
  let lastStatusChange = nowSeconds();
  const status = (): "Healthy" | "HealthyBusy" =>
    running.size > 0 ? "HealthyBusy" : "Healthy";
  /** Runs `change` on the job set, and records the time if the status flipped. */
  const updateRunning = (change: () => void): void => {
    const before = status();
    change();
    if (status() !== before) {
      lastStatusChange = nowSeconds();
    }
  };

  const listener = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const path = (request.url ?? "").split("?")[0];
    if (request.method === "GET" && path === "/ping") {
      respond(response, 200, {
        status: status(),
        time_of_last_update: lastStatusChange,
      });
      return;
    }
    if (request.method !== "POST" || path !== "/invocations") {
      respond(response, 404, { error: "not found" });
      return;
    }
    let job: AgentcoreJobDocument<TInput>;
    try {
      job = parseJobRequest<TInput>(
        await readJson(request, MAX_JOB_BODY_BYTES),
      ) as AgentcoreJobDocument<TInput>;
    } catch (error) {
      // readJson and parseJobRequest throw InvalidRunHookPayloadError for a
      // body that is too large, not JSON, or not a valid job document.
      const message = (error as Error).message;
      logger.warn("invalid job document", { error: message });
      respond(response, 400, { error: message });
      return;
    }
    const header = request.headers[SESSION_ID_HEADER];
    const sessionId = typeof header === "string" ? header : undefined;
    if (accepted.has(job.callbackId)) {
      logger.info("job already accepted", {
        callbackId: job.callbackId,
        runtimeSessionId: sessionId,
      });
      respond(response, 200, { accepted: true });
      return;
    }
    accepted.add(job.callbackId);
    if (accepted.size > MAX_REMEMBERED_JOBS) {
      accepted.delete(accepted.values().next().value as string);
    }
    // runJob catches the failures of the job. The last catch is a guard: an
    // unhandled rejection would end the process.
    const run: Promise<void> = runJob(options, logger, job, sessionId)
      .finally(() => updateRunning(() => running.delete(run)))
      .catch(() => undefined);
    updateRunning(() => running.add(run));
    respond(response, 200, { accepted: true });
  };

  const server: Server = createServer((request, response) => {
    void listener(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    idle: async (): Promise<void> => {
      while (running.size > 0) {
        await Promise.allSettled([...running]);
      }
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/**
 * Runs one job: heartbeats while the handler runs, then the outcome. It
 * never rejects. A failure to report is logged.
 *
 * The caller answers the request after it calls this function. A handler
 * can start with long synchronous work. If that work ran before the answer,
 * AgentCore Runtime would get no answer, and it fails the request with
 * "Runtime initialization time exceeded". So the job starts on a later turn
 * of the event loop, after the answer is written.
 */
async function runJob<TInput, TOutput>(
  options: AgentcoreWorkerOptions<TInput, TOutput>,
  logger: AgentcoreWorkerLogger,
  job: AgentcoreJobDocument<TInput>,
  sessionId: string | undefined,
): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  const { callbackId, region } = job;
  // The fields of every log line of the job.
  const fields = { callbackId, runtimeSessionId: sessionId };
  let reporter: CallbackReporter;
  try {
    reporter = new CallbackReporter({
      callbackId,
      region,
      client: options.createClient?.(region),
      warn: (message, data) => logger.warn(message, data),
    });
  } catch (error) {
    // Without a client, the worker cannot report anything. The durable
    // function fails the job at its heartbeat timeout or its timeout. The
    // MicroVM worker handles this case the same way.
    logger.error("could not create the Lambda client for the job", {
      ...fields,
      error: String(error),
    });
    return;
  }
  const controller = new AbortController();
  let heartbeats: ReturnType<typeof startHeartbeats>;
  try {
    heartbeats = startHeartbeats(reporter, job, controller, undefined, logger);
  } catch (error) {
    // The job would run without heartbeats, and the function would fail it
    // only at its heartbeat timeout. So the worker fails the callback at
    // once and does not run the handler.
    logger.error("could not start heartbeats for the job", {
      ...fields,
      error: String(error),
    });
    try {
      await reporter.fail(error);
    } catch (reportError) {
      logger.error("job outcome could not be reported", {
        ...fields,
        error: String(reportError),
      });
    }
    reporter.close();
    return;
  }
  // Every step after the heartbeats start is inside the try. So the
  // finally block always stops them.
  try {
    logger.info("job started", fields);
    let outcome: { ok: true; value: TOutput } | { ok: false; error: unknown };
    try {
      outcome = {
        ok: true,
        value: await options.handler(job.input, {
          callbackId,
          ...(sessionId !== undefined && { sessionId }),
          region,
          signal: controller.signal,
          logger,
        }),
      };
    } catch (error) {
      outcome = { ok: false, error };
    }
    // Heartbeats keep running while the outcome is reported. A completion
    // attempt can stall for up to 30 seconds.
    heartbeats.handlerSettled();
    if (controller.signal.aborted) {
      logger.warn("job outcome not reported: the callback is gone", fields);
      return;
    }
    if (outcome.ok) {
      try {
        await reporter.succeed(outcome.value);
      } catch (error) {
        // A result over the size limit, or one that is not JSON-serializable,
        // is never sent. Report it as a failure, so the durable function
        // learns why instead of waiting for its timeout.
        if (
          !(error instanceof ResultTooLargeError) &&
          !(error instanceof ResultSerializationError)
        ) {
          throw error;
        }
        await reporter.fail(error);
        logger.info("job failed", { ...fields, error: error.name });
        return;
      }
      logger.info("job succeeded", fields);
    } else {
      await reporter.fail(outcome.error);
      logger.info("job failed", fields);
    }
  } catch (error) {
    logger.error("job outcome could not be reported", {
      ...fields,
      error: String(error),
    });
  } finally {
    await heartbeats.stop();
    reporter.close();
  }
}

/** See the `host` parameter of {@link startAgentcoreWorker}. */
function defaultHost(): string {
  return process.env.AGENTCORE_RUNTIME_URL ? "0.0.0.0" : "127.0.0.1";
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function respond(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const jsonLogger: AgentcoreWorkerLogger = {
  info: (message, data) =>
    console.log(JSON.stringify({ level: "INFO", message, ...data })),
  warn: (message, data) =>
    console.warn(JSON.stringify({ level: "WARN", message, ...data })),
  error: (message, data) =>
    console.error(JSON.stringify({ level: "ERROR", message, ...data })),
};
