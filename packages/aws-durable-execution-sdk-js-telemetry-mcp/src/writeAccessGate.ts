/**
 * Stops the data tools until the user accepts the risk that queries could
 * change data.
 *
 * WHY THIS GATE ALWAYS ASKS.
 *
 * 1. The agent writes the SQL this server runs, and the agent can be
 *    prompt-injected.
 * 2. `assertReadOnly` reads query text. On Aurora and Redshift a SELECT can
 *    still write through a function, so it cannot block every write.
 * 3. Core's `checkWriteAccess` reports either `can-write` (it found a way) or
 *    `unverified` (it found none, could not look, or failed). It never reports
 *    read-only, because no check can show that.
 * 4. So the user accepts once per process before the first query, and the
 *    prompt says which of the two results the check gave.
 *
 * WHO CAN ACCEPT.
 *
 * Only the user. Acceptance comes from an elicitation prompt that the client
 * shows to the user, or from the {@link ACCEPT_WRITE_ACCESS_ENV_VAR} variable
 * in the client's server config. There is deliberately no tool that accepts,
 * because the agent could call it on the user's behalf.
 */
import type { WriteAccessResult } from "@aws/durable-execution-sdk-js-telemetry-core";
import { ACCEPT_WRITE_ACCESS_ENV_VAR } from "./envKeys";

export { ACCEPT_WRITE_ACCESS_ENV_VAR };

/** True when the environment accepts the risk. Only `true` (any case) counts. */
export function writeAccessAcceptedByEnv(env: NodeJS.ProcessEnv): boolean {
  return /^true$/i.test((env[ACCEPT_WRITE_ACCESS_ENV_VAR] ?? "").trim());
}

/**
 * The user's answer to the prompt. `undefined` means the client cannot show
 * a prompt.
 */
export type PromptAnswer = "accept" | "decline" | "cancel" | undefined;

export interface WriteAccessGateDeps {
  /** Runs core's check against the configured destination. */
  check: () => Promise<WriteAccessResult>;
  /** Whether {@link ACCEPT_WRITE_ACCESS_ENV_VAR} accepts the risk. */
  acceptedByEnv: boolean;
  /** Shows `message` to the user and returns the answer. */
  ask: (message: string) => Promise<PromptAnswer>;
}

/**
 * The part of the MCP SDK's low-level `Server` that {@link askUserToAccept}
 * uses. Declared structurally so a test can pass a fake.
 */
export interface ElicitingServer {
  getClientCapabilities(): { elicitation?: { form?: object } } | undefined;
  elicitInput(params: {
    message: string;
    requestedSchema: {
      type: "object";
      properties: Record<
        string,
        { type: "boolean"; title: string; default: boolean }
      >;
      required: string[];
    };
  }): Promise<{ action: "accept" | "decline" | "cancel"; content?: unknown }>;
}

/**
 * Asks the user, through MCP form elicitation, to accept credentials that can
 * change data. Returns `undefined` when the client cannot show a form.
 *
 * The form has one checkbox that defaults to unchecked. A user who submits the
 * form without checking it has not accepted, so that counts as a decline.
 */
export async function askUserToAccept(
  server: ElicitingServer,
  message: string,
): Promise<PromptAnswer> {
  if (!server.getClientCapabilities()?.elicitation?.form) return undefined;
  const answer = await server.elicitInput({
    message,
    requestedSchema: {
      type: "object",
      properties: {
        acceptRisk: {
          type: "boolean",
          title: "I accept that queries in this session can change data",
          default: false,
        },
      },
      required: ["acceptRisk"],
    },
  });
  if (answer.action !== "accept") return answer.action;
  const content = answer.content as { acceptRisk?: unknown } | undefined;
  return content?.acceptRisk === true ? "accept" : "decline";
}

/** The tool-result payload returned instead of running the query. */
export interface WriteAccessBlocked {
  error: string;
  writeAccess: WriteAccessResult;
  howToAccept: string;
}

/**
 * Returns a function that the data tools call before each query. It resolves
 * to `null` when the query may run, or to a {@link WriteAccessBlocked} payload.
 *
 * Once the query may run, it may run for the rest of the process, so the
 * check and the prompt happen at most once after acceptance. A blocked result
 * is not remembered: the next tool call checks and asks again.
 */
export function createWriteAccessGate(
  deps: WriteAccessGateDeps,
): () => Promise<WriteAccessBlocked | null> {
  let allowed = deps.acceptedByEnv;
  // Concurrent tool calls share one check and one prompt.
  let pending: Promise<WriteAccessBlocked | null> | undefined;

  async function decide(): Promise<WriteAccessBlocked | null> {
    const result = await deps.check();
    let answer: PromptAnswer;
    try {
      answer = await deps.ask(promptMessage(result));
    } catch {
      // The client advertised prompts but the request failed. Treat it like a
      // client that cannot prompt, so the user still gets the env var route.
      answer = undefined;
    }
    if (answer === "accept") {
      allowed = true;
      return null;
    }
    return blocked(result, answer);
  }

  return async () => {
    if (allowed) return null;
    pending ??= decide().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}

function describe(result: WriteAccessResult): string {
  if (result.status === "can-write") {
    return `The credentials this server uses can change data. ${result.findings.join(" ")}`;
  }
  return (
    "The server could not confirm that its credentials are read-only. " +
    result.reason
  );
}

function promptMessage(result: WriteAccessResult): string {
  return (
    `${describe(result)} ` +
    "Queries are written by the agent, and the server's read-only check " +
    "reads query text, so it cannot block every write. Accept to continue " +
    "for this session."
  );
}

function blocked(
  result: WriteAccessResult,
  answer: PromptAnswer,
): WriteAccessBlocked {
  const reason =
    answer === undefined
      ? "The client cannot show an accept prompt."
      : "The user did not accept the risk.";
  return {
    error: `Refused to run queries. ${describe(result)} ${reason}`,
    writeAccess: result,
    howToAccept:
      `Ask the user to switch to read-only credentials, or to set ` +
      `${ACCEPT_WRITE_ACCESS_ENV_VAR}=true in this server's env block and ` +
      `restart it. Only the user can accept; there is no tool for it.`,
  };
}
