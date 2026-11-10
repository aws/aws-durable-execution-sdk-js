// llm() and the AWS decider transports when their optional AWS SDK client cannot
// be loaded. Each test loads the module in isolation, with the package
// replaced by a throwing factory.
import type * as Ai from "..";

const ctx = {
  step: (_name: string, fn: () => Promise<unknown>) => fn(),
} as unknown as Parameters<Ai.Llm["ask"]>[0];

function loadWithout(pkg: string, error: Error): typeof Ai {
  let ai: typeof Ai | undefined;
  jest.isolateModules(() => {
    jest.doMock(pkg, () => {
      throw error;
    });
    // biome-ignore lint/style/noCommonJs: jest.isolateModules needs a synchronous load so the mock applies
    ai = require("..");
  });
  return ai as typeof Ai;
}

afterEach(() => {
  jest.dontMock("@aws-sdk/client-bedrock-runtime");
  jest.dontMock("@aws-sdk/client-bedrock-agentcore");
  jest.dontMock("@aws-sdk/client-sagemaker-runtime");
  jest.dontMock("@aws-sdk/client-lambda");
});

const missingModule = () =>
  Object.assign(new Error("Cannot find module"), { code: "MODULE_NOT_FOUND" });

it("fails ask with an AiError that names the missing package, and keeps decider() working", async () => {
  const missing = missingModule();
  const ai = loadWithout("@aws-sdk/client-bedrock-runtime", missing);

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
  expect(error?.cause).toBe(missing);
  expect(ai.defaultAiRetryStrategy(error as Error, 1).shouldRetry).toBe(false);
});

it("says the package could not be loaded when it is there but fails", async () => {
  const broken = new SyntaxError("Unexpected token");
  const ai = loadWithout("@aws-sdk/client-bedrock-runtime", broken);

  const error = await ai
    .llm()
    .ask(ctx, "Q?")
    .then(
      () => undefined,
      (e: unknown) => e as Error,
    );
  expect(error?.message).toContain("could not load");
  expect(error?.cause).toBe(broken);
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
  async (_name, pkg, transport) => {
    const missing = missingModule();
    const ai = loadWithout(pkg, missing);
    const decide = ai.decider({ transport: transport(ai) });

    const error = await decide.check(ctx, "Q?", "x").then(
      () => undefined,
      (e: unknown) => e as Error,
    );

    expect(error).toBeInstanceOf(ai.AiError);
    expect(error?.message).toContain(`${_name}() needs the ${pkg} package`);
    expect(error?.cause).toBe(missing);
    expect(ai.defaultAiRetryStrategy(error as Error, 1).shouldRetry).toBe(
      false,
    );
  },
);
