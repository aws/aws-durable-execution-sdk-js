import type { WriteAccessResult } from "@aws/durable-execution-sdk-js-telemetry-core";
import {
  ACCEPT_WRITE_ACCESS_ENV_VAR,
  askUserToAccept,
  createWriteAccessGate,
  type ElicitingServer,
  type PromptAnswer,
  writeAccessAcceptedByEnv,
} from "./writeAccessGate";

const CAN_WRITE: WriteAccessResult = {
  status: "can-write",
  findings: ["The database user is a superuser."],
};

function gate(opts: {
  result: WriteAccessResult;
  answer?: PromptAnswer | Error;
  acceptedByEnv?: boolean;
}) {
  const check = jest.fn(async () => opts.result);
  const ask = jest.fn(async () => {
    if (opts.answer instanceof Error) throw opts.answer;
    return opts.answer;
  });
  const run = createWriteAccessGate({
    check,
    ask,
    acceptedByEnv: opts.acceptedByEnv ?? false,
  });
  return { run, check, ask };
}

describe("createWriteAccessGate", () => {
  it.each([
    CAN_WRITE,
    { status: "unverified", reason: "Nothing found." },
  ] as WriteAccessResult[])(
    "asks the user when the check reports $status",
    async (result) => {
      const { run, ask } = gate({ result, answer: "accept" });
      expect(await run()).toBeNull();
      expect(ask).toHaveBeenCalledTimes(1);
    },
  );

  it("blocks with the findings when the user declines", async () => {
    const { run } = gate({ result: CAN_WRITE, answer: "decline" });
    const blocked = await run();
    expect(blocked?.writeAccess).toEqual(CAN_WRITE);
    expect(blocked?.error).toContain("The database user is a superuser.");
    expect(blocked?.error).toContain("The user did not accept the risk.");
    expect(blocked?.howToAccept).toContain(ACCEPT_WRITE_ACCESS_ENV_VAR);
  });

  it("tells an unverified user that the credentials are unconfirmed", async () => {
    const { run, ask } = gate({
      result: { status: "unverified", reason: "Nothing found." },
      answer: "decline",
    });
    const blocked = await run();
    expect(ask.mock.calls[0]).toEqual([
      expect.stringContaining(
        "could not confirm that its credentials are read-only. Nothing found.",
      ),
    ]);
    expect(blocked?.error).toContain("Nothing found.");
  });

  it("blocks when the client cannot show a prompt", async () => {
    const { run } = gate({ result: CAN_WRITE, answer: undefined });
    expect((await run())?.error).toContain(
      "The client cannot show an accept prompt.",
    );
  });

  it("blocks like a client without prompts when the prompt request fails", async () => {
    const { run } = gate({ result: CAN_WRITE, answer: new Error("timeout") });
    expect((await run())?.error).toContain(
      "The client cannot show an accept prompt.",
    );
  });

  it("checks and asks only once after the user accepts", async () => {
    const { run, check, ask } = gate({ result: CAN_WRITE, answer: "accept" });
    await run();
    expect(await run()).toBeNull();
    expect(check).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("asks again on the next call after a decline", async () => {
    const { run, ask } = gate({ result: CAN_WRITE, answer: "decline" });
    await run();
    await run();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("shares one check and one prompt between concurrent calls", async () => {
    const { run, check, ask } = gate({ result: CAN_WRITE, answer: "accept" });
    await Promise.all([run(), run(), run()]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("skips the check entirely when the environment accepts the risk", async () => {
    const { run, check } = gate({ result: CAN_WRITE, acceptedByEnv: true });
    expect(await run()).toBeNull();
    expect(check).not.toHaveBeenCalled();
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
      { action: "accept", content: { acceptRisk: true } },
    );
    expect(await askUserToAccept(s, "m")).toBe("accept");
    expect(s.elicitInput).toHaveBeenCalledWith(
      expect.objectContaining({ message: "m" }),
    );
  });

  it("treats a submitted form with the box unchecked as a decline", async () => {
    const s = server(
      { elicitation: { form: {} } },
      { action: "accept", content: { acceptRisk: false } },
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
      { action: "accept", content: { acceptRisk: true } },
    );
    expect(await askUserToAccept(server.server, "risk")).toBe("accept");
    expect(received).toEqual([
      expect.objectContaining({ mode: "form", message: "risk" }),
    ]);
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
      { action: "accept", content: { acceptRisk: "yes" } },
    );
    await expect(askUserToAccept(server.server, "risk")).rejects.toThrow();
    await client.close();
  });
});
