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
 * shows to the user, or from the {@link ACCEPT_WRITE_ACCESS_ENV_VAR} variable
 * in the client's server config. There is deliberately no tool that confirms,
 * because the agent could call it on the user's behalf.
 */
import { ACCEPT_WRITE_ACCESS_ENV_VAR } from "./envKeys";

export { ACCEPT_WRITE_ACCESS_ENV_VAR };

/** True when the environment confirms. Only `true` (any case) counts. */
export function writeAccessAcceptedByEnv(env: NodeJS.ProcessEnv): boolean {
  return /^true$/i.test((env[ACCEPT_WRITE_ACCESS_ENV_VAR] ?? "").trim());
}

/**
 * The user's answer to the prompt. `undefined` means the client cannot show
 * a prompt.
 */
export type PromptAnswer =
  | "accept"
  | "accept-always"
  | "decline"
  | "cancel"
  | undefined;

/** The one line the user is asked to confirm. */
export const CONSENT_MESSAGE =
  "Queries are written by the agent and run with this server's credentials. " +
  "It is your responsibility to give this server read-only credentials.";

export interface WriteAccessGateDeps {
  /** Whether {@link ACCEPT_WRITE_ACCESS_ENV_VAR} confirms. */
  acceptedByEnv: boolean;
  /** Shows `message` to the user and returns the answer. */
  ask: (message: string) => Promise<PromptAnswer>;
  /**
   * A problem with the destination's configuration that the user must also
   * see before the first query, or `undefined` when there is none. It is
   * added to the prompt and to a blocked result.
   */
  configurationWarning: () => Promise<string | undefined>;
  /**
   * Saved "don't ask again" answers for this configuration. Optional: without
   * it the checkbox behaves like a plain confirm.
   */
  remembered?: {
    has: () => Promise<boolean>;
    add: () => Promise<void>;
  };
  /** Diagnostics sink, for failures the user should be able to find. */
  log?: (message: string) => void;
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
 * Asks the user, through MCP form elicitation, to confirm `message`. Returns
 * `undefined` when the client cannot show a form.
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
        confirmed: {
          type: "boolean",
          title: "I understand, and I want to continue",
          default: false,
        },
        dontAskAgain: {
          type: "boolean",
          title: "Don't ask again",
          default: false,
        },
      },
      required: ["confirmed"],
    },
  });
  if (answer.action !== "accept") return answer.action;
  const content = answer.content as
    | { confirmed?: unknown; dontAskAgain?: unknown }
    | undefined;
  // "Don't ask again" only counts together with the confirm box.
  if (content?.confirmed !== true) return "decline";
  return content.dontAskAgain === true ? "accept-always" : "accept";
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
    // A saved answer covers the fixed notice only. A configuration warning is
    // new information, so it is always shown.
    if (!warning && (await rememberedHas())) {
      allowed = true;
      return null;
    }
    const message = warning ? `${CONSENT_MESSAGE} ${warning}` : CONSENT_MESSAGE;
    let answer: PromptAnswer;
    try {
      answer = await deps.ask(message);
    } catch {
      // The client advertised prompts but the request failed. Treat it like a
      // client that cannot prompt, so the user still gets the env var route.
      answer = undefined;
    }
    if (answer === "accept" || answer === "accept-always") {
      allowed = true;
      if (answer === "accept-always") {
        try {
          await deps.remembered?.add();
        } catch (err) {
          // This session is still confirmed; the next one asks again. Say why,
          // or the user is asked every session with no explanation.
          deps.log?.(
            `could not save "Don't ask again", so the next session asks again: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return null;
    }
    return blocked(message, answer);
  }

  async function rememberedHas(): Promise<boolean> {
    try {
      return (await deps.remembered?.has()) ?? false;
    } catch {
      return false;
    }
  }

  return async () => {
    if (allowed) return null;
    pending ??= decide().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}

function blocked(message: string, answer: PromptAnswer): WriteAccessBlocked {
  const reason =
    answer === undefined
      ? "The client cannot show a confirmation prompt."
      : "The user did not confirm.";
  return {
    error: `Refused to run queries. ${message} ${reason}`,
    howToAccept:
      `Ask the user to confirm, or to set ${ACCEPT_WRITE_ACCESS_ENV_VAR}=true ` +
      `in this server's env block and restart it. Only the user can confirm; ` +
      `there is no tool for it.`,
  };
}
