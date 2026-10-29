import {
  ACCEPT_WRITE_ACCESS_ENV_VAR,
  askUserToAccept,
  CONSENT_MESSAGE,
  createWriteAccessGate,
  type ElicitingServer,
  PERSIST_HINT,
  type PromptAnswer,
  writeAccessAcceptedByEnv,
} from "./writeAccessGate";

function gate(opts: {
  answer?: PromptAnswer | Error;
  acceptedByEnv?: boolean;
  warning?: string;
}) {
  const ask = jest.fn(async () => {
    if (opts.answer instanceof Error) throw opts.answer;
    return opts.answer;
  });
  const configurationWarning = jest.fn(async () => opts.warning);
  const run = createWriteAccessGate({
    ask,
    acceptedByEnv: opts.acceptedByEnv ?? false,
    configurationWarning,
  });
  return { run, ask, configurationWarning };
}

describe("createWriteAccessGate", () => {
  it("asks the user to confirm the read-only responsibility", async () => {
    const { run, ask } = gate({ answer: "accept" });
    expect(await run()).toBeNull();
    expect(ask).toHaveBeenCalledWith(CONSENT_MESSAGE);
    expect(CONSENT_MESSAGE).toContain(
      "It is your responsibility to give this server read-only credentials.",
    );
  });

  it("blocks with the message when the user declines", async () => {
    const { run } = gate({ answer: "decline" });
    const blocked = await run();
    expect(blocked?.error).toContain(CONSENT_MESSAGE);
    expect(blocked?.error).toContain("The user did not confirm.");
    expect(blocked?.howToAccept).toContain(ACCEPT_WRITE_ACCESS_ENV_VAR);
  });

  it("blocks when the client cannot show a prompt", async () => {
    const { run } = gate({ answer: undefined });
    expect((await run())?.error).toContain(
      "The client cannot show a confirmation prompt.",
    );
  });

  it("blocks like a client without prompts when the prompt request fails", async () => {
    const { run } = gate({ answer: new Error("timeout") });
    expect((await run())?.error).toContain(
      "The client cannot show a confirmation prompt.",
    );
  });

  it("asks only once after the user confirms", async () => {
    const { run, ask } = gate({ answer: "accept" });
    await run();
    expect(await run()).toBeNull();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("asks again on the next call after a decline", async () => {
    const { run, ask } = gate({ answer: "decline" });
    await run();
    await run();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("shares one prompt and one configuration check between concurrent calls", async () => {
    const { run, ask, configurationWarning } = gate({ answer: "accept" });
    await Promise.all([run(), run(), run()]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(configurationWarning).toHaveBeenCalledTimes(1);
  });

  it("adds a configuration warning to the prompt and to a blocked result", async () => {
    const { run, ask } = gate({
      answer: "decline",
      warning: "Results land in the data.",
    });
    const blocked = await run();
    expect(ask).toHaveBeenCalledWith(
      `${CONSENT_MESSAGE} Results land in the data.`,
    );
    expect(blocked?.error).toContain("Results land in the data.");
  });

  it("never asks when the environment confirms", async () => {
    const { run, ask } = gate({ acceptedByEnv: true });
    expect(await run()).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("writeAccessAcceptedByEnv", () => {
  it.each([
    ["true", true],
    [" TRUE ", true],
    ["1", false],
    ["yes", false],
    ["", false],
  ])("%j → %s", (value, expected) => {
    expect(
      writeAccessAcceptedByEnv({ [ACCEPT_WRITE_ACCESS_ENV_VAR]: value }),
    ).toBe(expected);
  });

  it("is false when the variable is unset", () => {
    expect(writeAccessAcceptedByEnv({})).toBe(false);
  });
});

describe("askUserToAccept", () => {
  function server(
    capabilities: ReturnType<ElicitingServer["getClientCapabilities"]>,
    reply: Awaited<ReturnType<ElicitingServer["elicitInput"]>>,
  ) {
    return {
      getClientCapabilities: () => capabilities,
      elicitInput: jest.fn(async () => reply),
    };
  }

  it("returns undefined without asking when the client has no form elicitation", async () => {
    const s = server({}, { action: "accept" });
    expect(await askUserToAccept(s, "m")).toBeUndefined();
    expect(s.elicitInput).not.toHaveBeenCalled();
  });

  it("accepts only when the user checks the box", async () => {
    const s = server(
      { elicitation: { form: {} } },
      { action: "accept", content: { confirmed: true } },
    );
    expect(await askUserToAccept(s, "m")).toBe("accept");
    expect(s.elicitInput).toHaveBeenCalledWith(
      expect.objectContaining({ message: `m ${PERSIST_HINT}` }),
    );
  });

  it("treats a submitted form with the box unchecked as a decline", async () => {
    const s = server(
      { elicitation: { form: {} } },
      { action: "accept", content: { confirmed: false } },
    );
    expect(await askUserToAccept(s, "m")).toBe("decline");
  });

  it.each(["decline", "cancel"] as const)(
    "passes through %s",
    async (action) => {
      const s = server({ elicitation: { form: {} } }, { action });
      expect(await askUserToAccept(s, "m")).toBe(action);
    },
  );
});

// Runs askUserToAccept against the real SDK server and client, connected in
// memory. This proves the SDK accepts the form schema, validates the reply
// against it, and reports a client without elicitation as unable to ask.
describe("askUserToAccept against the MCP SDK", () => {
  async function connect(
    clientCapabilities: Record<string, unknown>,
    reply: { action: "accept" | "decline" | "cancel"; content?: unknown },
  ) {
    const { McpServer } = await import(
      "@modelcontextprotocol/sdk/server/mcp.js"
    );
    const { Client } = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );
    const { InMemoryTransport } = await import(
      "@modelcontextprotocol/sdk/inMemory.js"
    );
    const { ElicitRequestSchema } = await import(
      "@modelcontextprotocol/sdk/types.js"
    );
    const server = new McpServer({ name: "s", version: "0" });
    const client = new Client(
      { name: "c", version: "0" },
      { capabilities: clientCapabilities },
    );
    const received: unknown[] = [];
    if (clientCapabilities.elicitation) {
      client.setRequestHandler(ElicitRequestSchema, async (request) => {
        received.push(request.params);
        return reply as never;
      });
    }
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return { server, client, received };
  }

  it("shows the prompt and accepts when the user checks the box", async () => {
    const { server, client, received } = await connect(
      { elicitation: {} },
      { action: "accept", content: { confirmed: true } },
    );
    expect(await askUserToAccept(server.server, "risk")).toBe("accept");
    expect(received).toEqual([
      expect.objectContaining({
        mode: "form",
        message: `risk ${PERSIST_HINT}`,
      }),
    ]);
    expect(PERSIST_HINT).toContain(`${ACCEPT_WRITE_ACCESS_ENV_VAR}=true`);
    await client.close();
  });

  it("returns undefined when the client did not declare elicitation", async () => {
    const { server, client } = await connect({}, { action: "accept" });
    expect(await askUserToAccept(server.server, "risk")).toBeUndefined();
    await client.close();
  });

  it("rejects a reply that does not match the form schema", async () => {
    const { server, client } = await connect(
      { elicitation: {} },
      { action: "accept", content: { confirmed: "yes" } },
    );
    await expect(askUserToAccept(server.server, "risk")).rejects.toThrow();
    await client.close();
  });
});
