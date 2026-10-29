/**
 * Stops the data tools until the user confirms, once per process, that giving
 * this server read-only credentials is their responsibility.
 *
 * WHY THE SERVER ASKS INSTEAD OF CHECKING.
 *
 * 1. The agent writes the SQL this server runs, and the agent can be
 *    prompt-injected.
 * 2. `assertReadOnly` reads query text. On Aurora and Redshift a SELECT can
 *    still change data through functions, sequences and extensions, so it
 *    cannot block every write.
 * 3. No check of the credentials can show they are read-only, so the server
 *    does not try. The credentials' permissions are the only real protection,
 *    and only the user controls them.
 * 4. So the user confirms that responsibility before the first query.
 *
 * WHO CAN CONFIRM.
 *
 * Only the user. Confirmation comes from an elicitation prompt that the client
 * shows to the user, or from the {@link CONFIRMED_READONLY_ENV_VAR} variable
 * in the client's server config. There is deliberately no tool that confirms,
 * because the agent could call it on the user's behalf.
 */
import { CONFIRMED_READONLY_ENV_VAR } from "./envKeys";

export { CONFIRMED_READONLY_ENV_VAR };

/** True when the environment confirms. Only `true` (any case) counts. */
export function writeAccessAcceptedByEnv(env: NodeJS.ProcessEnv): boolean {
  return /^true$/i.test((env[CONFIRMED_READONLY_ENV_VAR] ?? "").trim());
}

/**
 * The user's answer to the prompt. `undefined` means the client cannot show
 * a prompt.
 */
export type PromptAnswer = "accept" | "decline" | "cancel" | undefined;

/**
 * The line the user confirms. It is written as the user's own statement,
 * because accepting the form is the confirmation.
 *
 * The prompt is kept short. Claude Code 2.1.312 shows about the first 169
 * characters of a prompt and cuts the rest.
 */
export const CONSENT_MESSAGE =
  "I confirm that this server's credentials are read-only.";

/**
 * Added to the prompt only. A user who confirms is otherwise not told how to
 * stop the prompt in later sessions. A blocked result already names the
 * variable in `howToAccept`.
 */
export const PERSIST_HINT = `To stop asking, set ${CONFIRMED_READONLY_ENV_VAR}=true.`;

export interface WriteAccessGateDeps {
  /** Whether {@link CONFIRMED_READONLY_ENV_VAR} confirms. */
  acceptedByEnv: boolean;
  /** Shows `message` to the user and returns the answer. */
  ask: (message: string) => Promise<PromptAnswer>;
  /**
   * A problem with the destination's configuration that the user must also
   * see before the first query, or `undefined` when there is none. It is
   * added to the prompt and to a blocked result.
   */
  configurationWarning: () => Promise<string | undefined>;
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
      properties: Record<string, never>;
    };
  }): Promise<{ action: "accept" | "decline" | "cancel"; content?: unknown }>;
}

/**
 * Asks the user, through MCP form elicitation, to confirm `message`. Returns
 * `undefined` when the client cannot show a form.
 *
 * The form has no fields. Accepting the form is the confirmation. A checkbox
 * that defaults to unchecked made a plain Submit count as a decline, and in
 * Claude Code that refused users who meant to confirm.
 */
export async function askUserToAccept(
  server: ElicitingServer,
  message: string,
): Promise<PromptAnswer> {
  if (!server.getClientCapabilities()?.elicitation?.form) return undefined;
  const answer = await server.elicitInput({
    message: `${message} ${PERSIST_HINT}`,
    requestedSchema: { type: "object", properties: {} },
  });
  return answer.action;
}

/** The tool-result payload returned instead of running the query. */
export interface WriteAccessBlocked {
  error: string;
  howToAccept: string;
}

/**
 * Returns a function that the data tools call before each query. It resolves
 * to `null` when the query may run, or to a {@link WriteAccessBlocked} payload.
 *
 * Once the user confirms, queries may run for the rest of the process. A
 * blocked result is not remembered: the next tool call asks again.
 */
export function createWriteAccessGate(
  deps: WriteAccessGateDeps,
): () => Promise<WriteAccessBlocked | null> {
  let allowed = deps.acceptedByEnv;
  // Concurrent tool calls share one prompt.
  let pending: Promise<WriteAccessBlocked | null> | undefined;

  async function decide(): Promise<WriteAccessBlocked | null> {
    const warning = await deps.configurationWarning();
    const message = warning ? `${CONSENT_MESSAGE} ${warning}` : CONSENT_MESSAGE;
    let answer: PromptAnswer;
    try {
      answer = await deps.ask(message);
    } catch {
      // The client advertised prompts but the request failed. Treat it like a
      // client that cannot prompt, so the user still gets the env var route.
      answer = undefined;
    }
    if (answer === "accept") {
      allowed = true;
      return null;
    }
    return blocked(warning, answer);
  }

  return async () => {
    if (allowed) return null;
    pending ??= decide().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}

function blocked(
  warning: string | undefined,
  answer: PromptAnswer,
): WriteAccessBlocked {
  const reason =
    answer === undefined
      ? "The client cannot show a prompt to confirm that this server's credentials are read-only."
      : "The user did not confirm that this server's credentials are read-only.";
  return {
    error: `Refused to run queries. ${reason}${warning ? ` ${warning}` : ""}`,
    howToAccept:
      `Ask the user to confirm, or to set ${CONFIRMED_READONLY_ENV_VAR}=true ` +
      `in this server's env block and restart it. Only the user can confirm; ` +
      `there is no tool for it.`,
  };
}
