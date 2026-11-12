// llm() and the AWS decider transports when their optional AWS SDK client
// cannot be loaded. Each test loads the module fresh, with the package
// replaced by a factory that throws.
import { afterEach, expect, it, vi } from "vitest";
import type * as Ai from "..";

const ctx = {
  step: (_name: string, fn: (ctx: unknown) => Promise<unknown>) => fn({}),
} as unknown as Parameters<Ai.Llm["ask"]>[0];

async function loadWithout(pkg: string, error: Error): Promise<typeof Ai> {
  vi.resetModules();
  vi.doMock(pkg, () => {
    throw error;
  });
  return import("..");
}

afterEach(() => {
  vi.doUnmock("@aws-sdk/client-bedrock-runtime");
  vi.doUnmock("@aws-sdk/client-bedrock-agentcore");
  vi.doUnmock("@aws-sdk/client-sagemaker-runtime");
  vi.doUnmock("@aws-sdk/client-lambda");
  vi.resetModules();
});

const missingModule = (): Error =>
  Object.assign(new Error("Cannot find module"), { code: "MODULE_NOT_FOUND" });

/** The error that vitest raises for a mock factory that throws. */
function rootCause(error: unknown): unknown {
  let current = error;
  while ((current as { cause?: unknown } | null)?.cause !== undefined) {
    current = (current as { cause: unknown }).cause;
  }
  return current;
}

it("fails ask with an AiError that names the missing package, and keeps decider() working", async () => {
  const missing = missingModule();
  const ai = await loadWithout("@aws-sdk/client-bedrock-runtime", missing);

  expect(typeof ai.decider({ endpoint: "http://127.0.0.1:1/x" }).check).toBe(
    "function",
  );
  const error = await ai
    .llm()
    .ask(ctx, "Q?")
    .then(
      () => undefined,
      (e: unknown) => e as Error,
    );
  expect(error).toBeInstanceOf(ai.AiError);
  expect(error?.message).toContain(
    "needs the @aws-sdk/client-bedrock-runtime package",
  );
  expect(rootCause(error)).toBe(missing);
  expect(ai.defaultAiRetryStrategy(error as Error, 1).shouldRetry).toBe(false);
});

it("says the package could not be loaded when it is there but fails", async () => {
  const broken = new SyntaxError("Unexpected token");
  const ai = await loadWithout("@aws-sdk/client-bedrock-runtime", broken);

  const error = await ai
    .llm()
    .ask(ctx, "Q?")
    .then(
      () => undefined,
      (e: unknown) => e as Error,
    );
  expect(error?.message).toContain("could not load");
  expect(rootCause(error)).toBe(broken);
});

it.each([
  [
    "agentCoreTransport",
    "@aws-sdk/client-bedrock-agentcore",
    (ai: typeof Ai) =>
      ai.agentCoreTransport({
        runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:1:runtime/x",
      }),
  ],
  [
    "sageMakerTransport",
    "@aws-sdk/client-sagemaker-runtime",
    (ai: typeof Ai) => ai.sageMakerTransport({ endpointName: "x" }),
  ],
  [
    "lambdaTransport",
    "@aws-sdk/client-lambda",
    (ai: typeof Ai) => ai.lambdaTransport({ functionName: "x" }),
  ],
] as const)(
  "fails a decider() call through %s with an AiError that names %s",
  async (name, pkg, transport) => {
    const missing = missingModule();
    const ai = await loadWithout(pkg, missing);
    const decide = ai.decider({ transport: transport(ai) });

    const error = await decide.check(ctx, "Q?", "x").then(
      () => undefined,
      (e: unknown) => e as Error,
    );

    expect(error).toBeInstanceOf(ai.AiError);
    expect(error?.message).toContain(`${name}() needs the ${pkg} package`);
    expect(rootCause(error)).toBe(missing);
    expect(ai.defaultAiRetryStrategy(error as Error, 1).shouldRetry).toBe(
      false,
    );
  },
);

it.each([
  [
    "@aws-sdk/client-lambda",
    "LambdaClient",
    "InvokeCommand",
    (ai: typeof Ai) => ai.lambdaTransport({ functionName: "x" }),
    (body: string) => ({
      StatusCode: 200,
      Payload: new TextEncoder().encode(body),
    }),
  ],
  [
    "@aws-sdk/client-sagemaker-runtime",
    "SageMakerRuntimeClient",
    "InvokeEndpointCommand",
    (ai: typeof Ai) => ai.sageMakerTransport({ endpointName: "x" }),
    (body: string) => ({ Body: new TextEncoder().encode(body) }),
  ],
  [
    "@aws-sdk/client-bedrock-agentcore",
    "BedrockAgentCoreClient",
    "InvokeAgentRuntimeCommand",
    (ai: typeof Ai) =>
      ai.agentCoreTransport({
        runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:1:runtime/x",
      }),
    (body: string) => ({
      statusCode: 200,
      response: { transformToString: async () => body },
    }),
  ],
] as const)(
  "creates one default %s client on first use and reuses it",
  async (pkg, clientName, commandName, transport, reply) => {
    const made: unknown[] = [];
    const body = JSON.stringify({
      answers: { answer: { type: "noul", noul: 0.9 } },
    });
    vi.resetModules();
    vi.doMock(pkg, () => ({
      [clientName]: class {
        constructor(config: unknown) {
          made.push(config);
        }
        async send(): Promise<unknown> {
          return reply(body);
        }
      },
      [commandName]: class {
        constructor(readonly input: unknown) {}
      },
    }));
    const ai = await import("..");
    const send = transport(ai);
    expect(made).toHaveLength(0);

    await send(
      { model: "m", state: "s", questions: {} },
      { abortSignal: undefined },
    );
    await send(
      { model: "m", state: "s", questions: {} },
      { abortSignal: undefined },
    );

    // The default client uses the function's Region and credentials.
    expect(made).toEqual([{}]);
  },
);

it("loads the AWS SDK client again after a failed load", async () => {
  let loads = 0;
  vi.resetModules();
  vi.doMock("@aws-sdk/client-sagemaker-runtime", () => {
    loads += 1;
    if (loads === 1) {
      throw missingModule();
    }
    return {
      SageMakerRuntimeClient: class {
        async send(): Promise<unknown> {
          return {
            Body: new TextEncoder().encode(
              JSON.stringify({
                answers: { answer: { type: "noul", noul: 0.9 } },
              }),
            ),
          };
        }
      },
      InvokeEndpointCommand: class {
        constructor(readonly input: unknown) {}
      },
    };
  });
  const ai = await import("..");
  const send = ai.sageMakerTransport({ endpointName: "x" });
  const request = { model: "m", state: "s", questions: {} };

  const first = await send(request, { abortSignal: undefined }).then(
    () => undefined,
    (e: unknown) => e as Error,
  );
  const second = await send(request, { abortSignal: undefined });

  expect(first).toBeInstanceOf(ai.AiError);
  expect(second).toEqual({ answers: { answer: { type: "noul", noul: 0.9 } } });
  expect(loads).toBe(2);
});

it("loads the Bedrock client again after a failed load, through the same llm()", async () => {
  let loads = 0;
  let clients = 0;
  vi.resetModules();
  vi.doMock("@aws-sdk/client-bedrock-runtime", () => {
    loads += 1;
    if (loads === 1) {
      throw missingModule();
    }
    return {
      BedrockRuntimeClient: class {
        constructor() {
          clients += 1;
        }
        async send(): Promise<unknown> {
          return {
            stopReason: "end_turn",
            output: { message: { content: [{ text: "ok" }] } },
          };
        }
      },
      ConverseCommand: class {
        constructor(readonly input: unknown) {}
      },
    };
  });
  const ai = await import("..");
  const model = ai.llm();

  const first = await model.ask(ctx, "Q?").then(
    () => undefined,
    (e: unknown) => e as Error,
  );
  const second = await model.ask(ctx, "Q?");
  await model.ask(ctx, "Q?");

  expect(first).toBeInstanceOf(ai.AiError);
  expect(second).toBe("ok");
  expect(loads).toBe(2);
  // The default client is created once and reused.
  expect(clients).toBe(1);
});

it.each(["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"])(
  "names the package to install for code %s",
  async (code) => {
    const missing = Object.assign(new Error("Cannot find module"), { code });
    const ai = await loadWithout("@aws-sdk/client-lambda", missing);
    const decide = ai.decider({
      transport: ai.lambdaTransport({ functionName: "x" }),
    });

    const error = await decide.check(ctx, "Q?", "x").then(
      () => undefined,
      (e: unknown) => e as Error,
    );

    expect(error?.message).toContain(
      "lambdaTransport() needs the @aws-sdk/client-lambda package",
    );
  },
);
