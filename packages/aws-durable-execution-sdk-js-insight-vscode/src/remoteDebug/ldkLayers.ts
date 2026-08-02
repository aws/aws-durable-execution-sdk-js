/*
 * Region → account table adapted from aws-toolkit-vscode (Apache-2.0),
 * packages/core/src/lambda/remoteDebugging/ldkLayers.ts
 */

/**
 * Per-region AWS-owned accounts that publish the LDK ("Lambda Debug Kit")
 * layers. Lambda layer ARNs are account-scoped AND region-scoped, and AWS
 * publishes the debug layer from a DIFFERENT account in every region — so a
 * static lookup table is the only way to build the ARN (there is no public
 * API to discover these). The table is transcribed verbatim from the AWS
 * Toolkit for VS Code, which is the canonical consumer of these layers.
 */
export const regionToAccount: Readonly<Record<string, string>> = {
  "us-east-1": "166855510987",
  "ap-northeast-1": "435951944084",
  "us-west-1": "397974708477",
  "us-west-2": "116489046076",
  "us-east-2": "372632330791",
  "ca-central-1": "816313119386",
  "eu-west-1": "020236748984",
  "eu-west-2": "199003954714",
  "eu-west-3": "490913546906",
  "eu-central-1": "944487268028",
  "eu-north-1": "351516301086",
  "ap-southeast-1": "812073016575",
  "ap-southeast-2": "185226997092",
  "ap-northeast-2": "241511115815",
  "ap-south-1": "926022987530",
  "sa-east-1": "313162186107",
  "ap-east-1": "416298298123",
  "me-south-1": "511027370648",
  "me-central-1": "766358817862",
};

/**
 * Layer version pinned across all regions (the toolkit's
 * `globalLayerVersion`). The layer's wrapper binary and the tunnel protocol
 * evolve together, so this version is what the rest of this module's
 * orchestration (env vars, wrapper path) was verified against — bump it
 * only after re-verifying against the toolkit source.
 */
export const GLOBAL_LAYER_VERSION = 3;

/**
 * Builds the debug-layer ARN for a region/architecture, e.g.
 * `arn:aws:lambda:us-east-1:166855510987:layer:LDKLayerX86:3`.
 *
 * @param region AWS region the function lives in (the layer must be in the
 *   same region — cross-region layer attachment is not allowed by Lambda).
 * @param arch The function's architecture; picks `LDKLayerX86` vs
 *   `LDKLayerArm64` (each region publishes both under the same account).
 * @param override When set, returned verbatim instead of the built ARN — a
 *   full layer-version ARN the caller wants to use (e.g. a newer version,
 *   or a privately mirrored copy in an unsupported region).
 * @returns The layer ARN, or `undefined` when the region has no published
 *   debug layer (and no override was given) — callers should surface that
 *   as "remote debugging is not available in this region".
 */
export function getDebugLayerArn(
  region: string,
  arch: "x86_64" | "arm64",
  override?: string,
): string | undefined {
  if (override) return override;
  const account = regionToAccount[region];
  if (!account) return undefined;
  const layerName = arch === "x86_64" ? "LDKLayerX86" : "LDKLayerArm64";
  return `arn:aws:lambda:${region}:${account}:layer:${layerName}:${GLOBAL_LAYER_VERSION}`;
}
