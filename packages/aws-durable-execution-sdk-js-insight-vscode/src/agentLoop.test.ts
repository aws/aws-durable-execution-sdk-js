// Mocks must be declared before importing the module under test. The Bedrock
// client is replaced with a scripted `send`, and the sandbox is stubbed so the
// truncation-note logic can be tested without the WASM VM. (Vars are prefixed
// `mock` so jest's hoist allowlist permits referencing them in the factories.)
const mockSend = jest.fn();
const mockRunSandboxedJs = jest.fn();

jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest
    .fn()
    .mockImplementation(() => ({ send: mockSend })),
  // Snapshot the input (esp. `messages`, which the loop mutates by reference)
  // so each call's arguments can be inspected as they were at send time.
  ConverseCommand: jest.fn().mockImplementation((input: unknown) => ({
    input: JSON.parse(JSON.stringify(input)),
  })),
}));

jest.mock("./sandbox", () => ({
  runSandboxedJs: (...args: unknown[]) => mockRunSandboxedJs(...args),
}));

import { runAgentLoop, type AgentQueryResult } from "./agentLoop";

// ─── helpers ─────────────────────────────────────────────────────────────────

function assistantTurn(...content: unknown[]) {
  return { output: { message: { role: "assistant", content } } };
}
function toolUse(name: string, input: unknown, toolUseId = `${name}-1`) {
  return { toolUse: { name, toolUseId, input } };
}
function messagesOf(
  callIndex: number,
): Array<{ role: string; content: unknown[] }> {
  return mockSend.mock.calls[callIndex][0].input.messages;
}
function lastMessageJson(callIndex: number): string {
  const msgs = messagesOf(callIndex);
  return JSON.stringify(msgs[msgs.length - 1]);
}

const OK_RESULT: AgentQueryResult = {
  columns: ["a"],
  rows: [["1"]],
  rowCount: 1,
};

function baseOpts(overrides: Record<string, unknown> = {}) {
  return {
    region: "us-east-1",
    credentials: {} as never,
    modelId: "model",
    question: "the question",
    destinationType: "s3" as const,
    tableName: "workflow_insight",
    maxIterations: 8,
    onStep: jest.fn(),
    runQuery: jest.fn(async () => OK_RESULT),
    ...overrides,
  };
}

beforeEach(() => {
  mockSend.mockReset();
  mockRunSandboxedJs.mockReset();
});

// ─── finish parsing ──────────────────────────────────────────────────────────

describe("runAgentLoop: finish parsing", () => {
  it("returns the finish fields (query, answer, explanation, charts, lookback)", async () => {
    mockSend.mockResolvedValueOnce(
      assistantTurn(
        toolUse("finish", {
          query: "SELECT 1",
          answer: "the answer",
          explanation: "does a thing",
          suggestedCharts: ["bar"],
          lookbackHours: 12,
        }),
      ),
    );
    const opts = baseOpts();
    const final = await runAgentLoop(opts);
    expect(final).toEqual({
      query: "SELECT 1",
      explanation: "does a thing",
      answer: "the answer",
      suggestedCharts: ["bar"],
      lookbackHours: 12,
    });
    // finish with no prior run_query means the callback is never invoked.
    expect(opts.runQuery).not.toHaveBeenCalled();
  });

  it("keeps query empty when the model omits it (conceptual answer, no table)", async () => {
    mockSend
      .mockResolvedValueOnce(
        assistantTurn(toolUse("run_query", { query: "SELECT * FROM t" })),
      )
      .mockResolvedValueOnce(
        assistantTurn(toolUse("finish", { answer: "it's in the input field" })),
      );
    const opts = baseOpts({ runQuery: jest.fn(async () => OK_RESULT) });
    const final = await runAgentLoop(opts);
    // Must NOT fall back to the explored query — no table should be shown.
    expect(final?.query).toBe("");
    expect(final?.answer).toBe("it's in the input field");
  });
});

// ─── oscillation guard ─────────────────────────────────────────────────────────

describe("runAgentLoop: oscillation guard", () => {
  it("does not re-run a repeated query; feeds an error back instead", async () => {
    mockSend
      .mockResolvedValueOnce(
        assistantTurn(toolUse("run_query", { query: "SELECT 1" }, "a")),
      )
      // same query (normalized) — should be blocked without calling runQuery
      .mockResolvedValueOnce(
        assistantTurn(toolUse("run_query", { query: "select   1" }, "b")),
      )
      .mockResolvedValueOnce(
        assistantTurn(toolUse("finish", { answer: "done" })),
      );
    const opts = baseOpts({ runQuery: jest.fn(async () => OK_RESULT) });
    await runAgentLoop(opts);

    expect(opts.runQuery).toHaveBeenCalledTimes(1);
    // The toolResult fed into the 3rd Converse call carries the guard error.
    expect(lastMessageJson(2)).toContain("already ran this exact query");
  });
});

// ─── run_javascript truncation note ────────────────────────────────────────────

describe("runAgentLoop: run_javascript truncation note", () => {
  it("notes when JS ran over fewer rows than the true total", async () => {
    mockRunSandboxedJs.mockResolvedValue({ ok: true, value: 42 });
    mockSend
      .mockResolvedValueOnce(
        assistantTurn(toolUse("run_query", { query: "SELECT a FROM t" })),
      )
      .mockResolvedValueOnce(
        assistantTurn(toolUse("run_javascript", { code: "return 1" })),
      )
      .mockResolvedValueOnce(assistantTurn(toolUse("finish", { answer: "x" })));

    const opts = baseOpts({
      runQuery: jest.fn(
        async (): Promise<AgentQueryResult> => ({
          columns: ["a"],
          rows: [["1"]],
          allRows: Array.from({ length: 5000 }, () => ["1"]),
          rowCount: 12000,
        }),
      ),
    });
    await runAgentLoop(opts);

    // The JS toolResult (fed into the 3rd call) should flag the truncation.
    expect(lastMessageJson(2)).toContain("first 5000 of 12000");
  });

  it("adds no note when JS covered the whole result", async () => {
    mockRunSandboxedJs.mockResolvedValue({ ok: true, value: 42 });
    mockSend
      .mockResolvedValueOnce(
        assistantTurn(toolUse("run_query", { query: "SELECT a FROM t" })),
      )
      .mockResolvedValueOnce(
        assistantTurn(toolUse("run_javascript", { code: "return 1" })),
      )
      .mockResolvedValueOnce(assistantTurn(toolUse("finish", { answer: "x" })));

    const opts = baseOpts({
      runQuery: jest.fn(
        async (): Promise<AgentQueryResult> => ({
          columns: ["a"],
          rows: [["1"], ["2"]],
          rowCount: 2,
        }),
      ),
    });
    await runAgentLoop(opts);
    expect(lastMessageJson(2)).not.toContain("first ");
  });
});

// ─── run_javascript guards (LIMIT note, size cap) ──────────────────────────────

describe("runAgentLoop: run_javascript guards", () => {
  const oneRow = jest.fn(
    async (): Promise<AgentQueryResult> => ({
      columns: ["a"],
      rows: [["1"]],
      rowCount: 1,
    }),
  );

  it("warns when the source query used a LIMIT (possible partial aggregate)", async () => {
    mockRunSandboxedJs.mockResolvedValue({ ok: true, value: 42 });
    mockSend
      .mockResolvedValueOnce(
        assistantTurn(
          toolUse("run_query", { query: "SELECT a FROM t LIMIT 100" }),
        ),
      )
      .mockResolvedValueOnce(
        assistantTurn(toolUse("run_javascript", { code: "return 1" })),
      )
      .mockResolvedValueOnce(assistantTurn(toolUse("finish", { answer: "x" })));
    await runAgentLoop(baseOpts({ runQuery: oneRow }));
    expect(lastMessageJson(2)).toContain("LIMIT");
  });

  it("rejects an oversized return value", async () => {
    mockRunSandboxedJs.mockResolvedValue({
      ok: true,
      value: "x".repeat(25000),
    });
    mockSend
      .mockResolvedValueOnce(
        assistantTurn(toolUse("run_query", { query: "SELECT a FROM t" })),
      )
      .mockResolvedValueOnce(
        assistantTurn(toolUse("run_javascript", { code: "return 1" })),
      )
      .mockResolvedValueOnce(assistantTurn(toolUse("finish", { answer: "x" })));
    await runAgentLoop(baseOpts({ runQuery: oneRow }));
    expect(lastMessageJson(2)).toContain("too large");
  });
});

// ─── priorTurns → messages alternation ─────────────────────────────────────────

describe("runAgentLoop: priorTurns seeding", () => {
  it("seeds prior turns then the question, preserving user/assistant alternation", async () => {
    mockSend.mockResolvedValueOnce(
      assistantTurn(toolUse("finish", { answer: "done" })),
    );
    await runAgentLoop(
      baseOpts({
        priorTurns: [
          { role: "user", text: "q1" },
          { role: "assistant", text: "a1" },
        ],
      }),
    );
    const msgs = messagesOf(0);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // The new question is the final (user) message.
    expect(JSON.stringify(msgs[2])).toContain("the question");
  });
});

// ─── parallel tool use ─────────────────────────────────────────────────────────

describe("runAgentLoop: parallel tool use", () => {
  it("answers every toolUse block with a matching toolResult", async () => {
    mockSend
      .mockResolvedValueOnce(
        assistantTurn(
          toolUse("run_query", { query: "Q1" }, "t1"),
          toolUse("run_query", { query: "Q2" }, "t2"),
        ),
      )
      .mockResolvedValueOnce(
        assistantTurn(toolUse("finish", { answer: "done" })),
      );
    const opts = baseOpts({ runQuery: jest.fn(async () => OK_RESULT) });
    await runAgentLoop(opts);

    expect(opts.runQuery).toHaveBeenCalledTimes(2);
    // The 2nd Converse call's last message must carry a toolResult per id.
    const msgs = messagesOf(1);
    const toolResultMsg = msgs[msgs.length - 1] as {
      content: Array<{ toolResult?: { toolUseId?: string } }>;
    };
    const ids = toolResultMsg.content.map((c) => c.toolResult?.toolUseId);
    expect(ids).toEqual(["t1", "t2"]);
  });
});

// ─── parallel tool ordering (run_query before run_javascript) ──────────────────

describe("runAgentLoop: parallel tool ordering", () => {
  it("runs run_query before run_javascript even when JS is listed first", async () => {
    mockRunSandboxedJs.mockResolvedValue({ ok: true, value: 99 });
    mockSend
      .mockResolvedValueOnce(
        assistantTurn(
          toolUse("run_javascript", { code: "return rows.length" }, "tjs"),
          toolUse("run_query", { query: "SELECT a FROM t" }, "tq"),
        ),
      )
      .mockResolvedValueOnce(assistantTurn(toolUse("finish", { answer: "x" })));
    await runAgentLoop(baseOpts({ runQuery: jest.fn(async () => OK_RESULT) }));
    // The JS block ran after the query, so it computed a result rather than
    // hitting the "no data yet" path. The toolResult text is itself JSON.
    const msgs = messagesOf(1);
    const results = msgs[msgs.length - 1].content as Array<{
      toolResult?: { toolUseId?: string; content?: Array<{ text?: string }> };
    }>;
    const jsBlock = results.find((c) => c.toolResult?.toolUseId === "tjs");
    const parsed = JSON.parse(jsBlock?.toolResult?.content?.[0]?.text ?? "{}");
    expect(parsed.result).toBe(99);
    expect(parsed.error).toBeUndefined();
  });
});

// ─── query budget (bounds parallel tool calls) ─────────────────────────────────

describe("runAgentLoop: query budget", () => {
  it("stops once the query budget is reached, even within one parallel turn", async () => {
    // One turn emits two parallel run_query blocks; with maxIterations=2 the
    // budget is hit after that turn, so no further Converse turn is requested.
    mockSend
      .mockResolvedValueOnce(
        assistantTurn(
          toolUse("run_query", { query: "Q1" }, "t1"),
          toolUse("run_query", { query: "Q2" }, "t2"),
        ),
      )
      .mockResolvedValueOnce(
        assistantTurn(toolUse("run_query", { query: "Q3" }, "t3")),
      );
    const opts = baseOpts({
      maxIterations: 2,
      runQuery: jest.fn(async () => OK_RESULT),
    });
    await runAgentLoop(opts);
    expect(opts.runQuery).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledTimes(1); // second turn never requested
  });
});
