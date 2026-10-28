/**
 * The execution-viewer messages on ExplorerSession: each reply names what it
 * answers and carries its own error, and a stop refreshes the execution.
 */
import { normalizeConfig } from "./configCore";
import { ExplorerSession } from "./explorerSession";
import type { HostPort } from "./hostPort";

const ARN =
  "arn:aws:lambda:eu-west-1:123456789012:function:fn:$LATEST/durable-execution/run-1/abc";

function setup(handlers: Record<string, (input: any) => unknown>) {
  const posted: Record<string, any>[] = [];
  const regions: string[] = [];
  const host: HostPort = {
    post: (m) => posted.push(m),
    readConfig: () => ({
      ...normalizeConfig({
        getString: () => undefined,
        getBool: () => undefined,
        getNumber: () => undefined,
      }),
      region: "us-east-1",
    }),
    writeSettings: async () => {},
    saveFile: async () => undefined,
    showInfo: () => {},
    readFavorites: () => [],
    writeFavorites: async () => {},
  };
  const session = new ExplorerSession(host, {
    lambdaClientFor: (region) => ({
      send: async (cmd: { constructor: { name: string }; input: unknown }) => {
        regions.push(region);
        const h = handlers[cmd.constructor.name];
        if (!h) throw new Error(`unexpected ${cmd.constructor.name}`);
        return h(cmd.input);
      },
    }),
  });
  return { session, posted, regions };
}

describe("execution viewer messages", () => {
  it("streams partial function lists, then the final one", async () => {
    const { session, posted } = setup({
      ListFunctionsCommand: () => ({
        Functions: [{ FunctionName: "fn", DurableConfig: {} }],
      }),
    });
    await session.dispatch({ type: "listFunctions" });
    expect(posted.map((m) => [m.type, m.loading])).toEqual([
      ["functionsList", true],
      ["functionsList", false],
    ]);
    expect(posted[1].functions).toEqual([
      {
        name: "fn",
        runtime: undefined,
        lastModified: undefined,
        packageType: undefined,
      },
    ]);
  });

  it("tags execution pages with the function and whether they append", async () => {
    const { session, posted } = setup({
      ListDurableExecutionsByFunctionCommand: (input) => ({
        DurableExecutions: [],
        NextMarker: input.Marker ? undefined : "next",
      }),
    });
    await session.dispatch({ type: "listExecutions", functionName: "fn" });
    await session.dispatch({
      type: "listExecutions",
      functionName: "fn",
      marker: "next",
    });
    expect(posted).toEqual([
      {
        type: "executionsList",
        functionName: "fn",
        append: false,
        executions: [],
        nextMarker: "next",
      },
      {
        type: "executionsList",
        functionName: "fn",
        append: true,
        executions: [],
        nextMarker: undefined,
      },
    ]);
  });

  it("returns an execution in its own region, and errors in the reply", async () => {
    const { session, posted, regions } = setup({
      GetDurableExecutionCommand: () => ({
        DurableExecutionArn: ARN,
        Status: "RUNNING",
      }),
      GetDurableExecutionHistoryCommand: () => ({ Events: [] }),
    });
    await session.dispatch({ type: "getExecution", arn: ARN });
    expect(regions).toEqual(["eu-west-1", "eu-west-1"]);
    expect(posted[0]).toMatchObject({
      type: "executionDetail",
      arn: ARN,
      detail: { status: "RUNNING" },
    });

    await session.dispatch({ type: "getExecution", arn: "bogus" });
    expect(posted[1]).toEqual({
      type: "executionDetail",
      arn: "bogus",
      error: "Not a durable execution ARN: bogus",
    });
    expect(posted.some((m) => m.type === "error")).toBe(false);
  });

  it("reports a started execution's ARN, or why there is none", async () => {
    let returnArn = true;
    const { session, posted } = setup({
      InvokeCommand: () => (returnArn ? { DurableExecutionArn: ARN } : {}),
    });
    await session.dispatch({
      type: "startExecution",
      functionName: "fn",
      payload: "{}",
    });
    returnArn = false;
    await session.dispatch({
      type: "startExecution",
      functionName: "fn",
      payload: "{}",
    });
    expect(posted[0]).toEqual({
      type: "executionStarted",
      functionName: "fn",
      arn: ARN,
    });
    expect(posted[1].error).toMatch(/no execution ARN/);
  });

  it("refreshes the execution after a stop, and not after a failed one", async () => {
    let fail = false;
    const { session, posted } = setup({
      StopDurableExecutionCommand: () => {
        if (fail) throw new Error("ResourceNotFound");
        return {};
      },
      GetDurableExecutionCommand: () => ({
        DurableExecutionArn: ARN,
        Status: "STOPPED",
      }),
      GetDurableExecutionHistoryCommand: () => ({ Events: [] }),
    });
    await session.dispatch({ type: "stopExecution", arn: ARN });
    expect(posted.map((m) => m.type)).toEqual([
      "executionStopped",
      "executionDetail",
    ]);
    expect(posted[1].detail.status).toBe("STOPPED");

    fail = true;
    posted.length = 0;
    await session.dispatch({ type: "stopExecution", arn: ARN });
    expect(posted).toEqual([
      { type: "executionStopped", arn: ARN, error: "ResourceNotFound" },
    ]);
  });
});
