const send = jest.fn();
jest.mock("@aws-sdk/client-bedrock", () => ({
  BedrockClient: jest.fn(() => ({ send, destroy: jest.fn() })),
  ListInferenceProfilesCommand: jest.fn((i) => ({ __t: "profiles", i })),
  ListFoundationModelsCommand: jest.fn((i) => ({ __t: "models", i })),
}));

import { listBedrockModels } from "./bedrockModels";

const creds = {} as never;

beforeEach(() => jest.clearAllMocks());

function route(handlers: {
  profiles?: unknown[];
  profilesPages?: Array<{
    inferenceProfileSummaries: unknown[];
    nextToken?: string;
  }>;
  models?: unknown[];
}) {
  let profilePage = 0;
  send.mockImplementation((cmd: { __t: string }) => {
    if (cmd.__t === "profiles") {
      if (handlers.profilesPages) {
        return Promise.resolve(handlers.profilesPages[profilePage++]);
      }
      return Promise.resolve({
        inferenceProfileSummaries: handlers.profiles ?? [],
      });
    }
    return Promise.resolve({ modelSummaries: handlers.models ?? [] });
  });
}

describe("listBedrockModels", () => {
  it("merges inference profiles and on-demand text models, deduped and sorted", async () => {
    route({
      profiles: [
        {
          inferenceProfileId: "us.anthropic.claude-sonnet-5",
          status: "ACTIVE",
        },
        { inferenceProfileId: "us.anthropic.claude-opus-5", status: "ACTIVE" },
      ],
      models: [
        {
          modelId: "anthropic.claude-instant",
          modelLifecycle: { status: "ACTIVE" },
          outputModalities: ["TEXT"],
          inferenceTypesSupported: ["ON_DEMAND"],
        },
      ],
    });
    const out = await listBedrockModels({
      region: "us-east-1",
      credentials: creds,
    });
    expect(out).toEqual([
      "anthropic.claude-instant",
      "us.anthropic.claude-opus-5",
      "us.anthropic.claude-sonnet-5",
    ]);
  });

  it("excludes inactive, non-text, and non-on-demand foundation models", async () => {
    route({
      profiles: [],
      models: [
        {
          modelId: "legacy.model",
          modelLifecycle: { status: "LEGACY" },
          outputModalities: ["TEXT"],
          inferenceTypesSupported: ["ON_DEMAND"],
        },
        {
          modelId: "image.only",
          modelLifecycle: { status: "ACTIVE" },
          outputModalities: ["IMAGE"],
          inferenceTypesSupported: ["ON_DEMAND"],
        },
        {
          modelId: "profile.only",
          modelLifecycle: { status: "ACTIVE" },
          outputModalities: ["TEXT"],
          inferenceTypesSupported: ["INFERENCE_PROFILE"],
        },
        {
          modelId: "good.model",
          modelLifecycle: { status: "ACTIVE" },
          outputModalities: ["TEXT"],
          inferenceTypesSupported: ["ON_DEMAND"],
        },
      ],
    });
    const out = await listBedrockModels({
      region: "us-east-1",
      credentials: creds,
    });
    expect(out).toEqual(["good.model"]);
  });

  it("skips non-active inference profiles", async () => {
    route({
      profiles: [
        { inferenceProfileId: "us.active", status: "ACTIVE" },
        { inferenceProfileId: "us.inactive", status: "INACTIVE" },
      ],
      models: [],
    });
    const out = await listBedrockModels({
      region: "us-east-1",
      credentials: creds,
    });
    expect(out).toEqual(["us.active"]);
  });

  it("paginates inference profiles via nextToken", async () => {
    route({
      profilesPages: [
        {
          inferenceProfileSummaries: [
            { inferenceProfileId: "us.one", status: "ACTIVE" },
          ],
          nextToken: "t1",
        },
        {
          inferenceProfileSummaries: [
            { inferenceProfileId: "us.two", status: "ACTIVE" },
          ],
        },
      ],
      models: [],
    });
    const out = await listBedrockModels({
      region: "us-east-1",
      credentials: creds,
    });
    expect(out).toEqual(["us.one", "us.two"]);
    // 2 profile pages + 1 foundation-models call
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("stops paginating after the page cap even if nextToken never clears", async () => {
    send.mockImplementation((cmd: { __t: string }) => {
      if (cmd.__t === "profiles") {
        return Promise.resolve({
          inferenceProfileSummaries: [
            { inferenceProfileId: "us.loop", status: "ACTIVE" },
          ],
          nextToken: "always", // never clears
        });
      }
      return Promise.resolve({ modelSummaries: [] });
    });
    const out = await listBedrockModels({
      region: "us-east-1",
      credentials: creds,
    });
    expect(out).toEqual(["us.loop"]);
    // 20 profile pages (cap) + 1 foundation-models call
    expect(send).toHaveBeenCalledTimes(21);
  });
});
