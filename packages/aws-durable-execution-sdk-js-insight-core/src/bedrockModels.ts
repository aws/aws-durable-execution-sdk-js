import {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} from "@aws-sdk/client-bedrock";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";

/** Overall timeout for the model-list calls (button-triggered, so keep it snappy). */
const MODEL_LIST_TIMEOUT_MS = 15_000;
/** Safety cap on inference-profile pages (100/page) so a buggy nextToken can't loop forever. */
const MAX_PROFILE_PAGES = 20;

/**
 * Lists the Bedrock model identifiers usable for text generation in the given
 * region, so the Settings UI can offer them as suggestions. Combines two
 * sources and returns a de-duplicated, sorted list of ids:
 *
 *  - System-defined inference profiles (e.g. `us.anthropic.claude-sonnet-5`),
 *    which are the directly-invokable ids for newer cross-region models.
 *  - On-demand foundation models (base ids like `anthropic.claude-...`) that are
 *    ACTIVE and produce TEXT. Models that ONLY support the INFERENCE_PROFILE
 *    type are skipped here because their base id isn't directly invokable — the
 *    matching inference profile above covers them.
 *
 * Note: this reflects models AVAILABLE in the region; a returned id may still
 * require model access to be granted in the Bedrock console before it can be
 * invoked.
 */
export async function listBedrockModels(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
}): Promise<string[]> {
  const client = new BedrockClient({
    region: opts.region,
    credentials: opts.credentials,
  });

  // Bound the whole operation so a hung socket (expired creds, unreachable
  // region) surfaces as an error in ~15s instead of spinning for the SDK's
  // default socket timeout (~minutes).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
  const sendOpts = { abortSignal: controller.signal };

  try {
    const ids = new Set<string>();

    // System-defined inference profiles (paginated).
    let nextToken: string | undefined;
    let page = 0;
    do {
      // Guard against a misbehaving API returning the same token forever.
      if (++page > MAX_PROFILE_PAGES) break;
      const out = await client.send(
        new ListInferenceProfilesCommand({
          typeEquals: "SYSTEM_DEFINED",
          maxResults: 100,
          nextToken,
        }),
        sendOpts,
      );
      for (const p of out.inferenceProfileSummaries ?? []) {
        if (p.inferenceProfileId && p.status === "ACTIVE") {
          ids.add(p.inferenceProfileId);
        }
      }
      nextToken = out.nextToken;
    } while (nextToken);

    // On-demand, active, text-output foundation models. ListFoundationModels is
    // not paginated (returns all summaries in one response).
    const fm = await client.send(new ListFoundationModelsCommand({}), sendOpts);
    for (const m of fm.modelSummaries ?? []) {
      if (!m.modelId) continue;
      const active = m.modelLifecycle?.status === "ACTIVE";
      const text = (m.outputModalities ?? []).includes("TEXT");
      const onDemand = (m.inferenceTypesSupported ?? []).includes("ON_DEMAND");
      if (active && text && onDemand) ids.add(m.modelId);
    }

    return Array.from(ids).sort((a, b) => a.localeCompare(b));
  } finally {
    clearTimeout(timer);
    client.destroy();
  }
}
