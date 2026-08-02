/*
 * Orchestration adapted from aws-toolkit-vscode (Apache-2.0),
 * packages/core/src/lambda/remoteDebugging/ldkClient.ts (createDebugDeployment /
 * createOrReuseTunnel / removeDebugDeployment).
 */

/**
 * vscode-free core of a Lambda remote debug session (LDK mechanism).
 *
 * The moving parts, end to end:
 *
 * 1. An AWS-published Lambda LAYER (see `ldkLayers.ts`) whose
 *    `/opt/bin/ldk_wrapper` exec-wrapper starts the Node runtime's inspector
 *    inside the sandbox and connects OUT to an IoT Secure Tunneling tunnel
 *    as the DESTINATION (using `AWS_LDK_DESTINATION_TOKEN`).
 * 2. This module opens that tunnel, then gives the debug session its OWN
 *    immutable function VERSION: it applies the layer + env vars + a
 *    15-minute timeout to `$LATEST`, calls `PublishVersion` to snapshot that
 *    into a numbered version, and immediately restores `$LATEST`. Everything
 *    afterwards targets the published version.
 *
 *    WHY A VERSION, not `$LATEST` (which the LDK layer also supports, via
 *    `AWS_LAMBDA_DEBUG_ON_LATEST`): per DAR-431, Lambda's placement service
 *    gives a debug session a sandbox dedicated to the version being debugged,
 *    and that dedication is what makes a durable execution's LATER
 *    invocations land back on the SAME sandbox and keep the debugger attached.
 *    Debugging `$LATEST` forfeits that: the sandbox is shared with any other
 *    `$LATEST` traffic, so re-attach becomes luck. A version also shrinks the
 *    blast radius enormously — `$LATEST` carries the debug layer for the few
 *    seconds between update and publish, instead of for the whole session.
 * 3. A local {@link LocalTunnelProxy} runs as the tunnel SOURCE, exposing the
 *    sandbox's inspector on `127.0.0.1:<port>` for any DAP client.
 * 4. `invoke()` triggers the PUBLISHED VERSION synchronously
 *    (`RequestResponse`) so the sandbox stays alive — the call simply blocks
 *    while the user sits at breakpoints, which is why the timeout is raised to
 *    the 900s max.
 * 5. `dispose()` stops the proxy and closes (and deletes) the tunnel.
 *    `$LATEST` was already restored in step 2 from an in-memory snapshot taken
 *    before any mutation. The published version is deleted ONLY when the
 *    caller confirms the execution finished — see
 *    {@link RemoteDebugHandle.dispose}.
 *
 * NO `vscode` imports here (mirrors `tunnelProxy.ts`'s rule): this module
 * must run in the extension host, a plain Node child process, and Electron.
 * All user feedback flows through the optional `onProgress` callback.
 *
 * IAM the CALLER's credentials need (this is the developer's own identity, not
 * the function's execution role):
 * - `lambda:GetFunctionConfiguration`, `lambda:UpdateFunctionConfiguration`
 * - `lambda:PublishVersion` — to snapshot the debug config into a version
 * - `lambda:DeleteFunction` on the version — to clean it up afterwards
 * - `lambda:InvokeFunction` on the published version
 * - `iotsecuretunneling:OpenTunnel`, `iotsecuretunneling:CloseTunnel`
 */

import {
  DeleteFunctionCommand,
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  PublishVersionCommand,
  UpdateFunctionConfigurationCommand,
  type FunctionConfiguration,
} from "@aws-sdk/client-lambda";
import {
  CloseTunnelCommand,
  IoTSecureTunnelingClient,
  OpenTunnelCommand,
} from "@aws-sdk/client-iotsecuretunneling";
import type {
  AwsCredentialIdentity,
  AwsCredentialIdentityProvider,
} from "@aws-sdk/types";
import { getDebugLayerArn } from "./ldkLayers";
import { LocalTunnelProxy } from "./tunnelProxy";

/** Lambda's hard cap on function timeout (15 min) — raised for the whole
 * debug session so an invoke can sit at breakpoints without being reaped. */
const DEBUG_TIMEOUT_SECONDS = 900;
/** Restored instead of DEBUG_TIMEOUT_SECONDS when a leftover (crashed)
 *  session's config is detected — the pre-debug timeout is unknowable then.
 *  60s matches this repo's own deploy default range for simple workflows. */
const DEFAULT_RESTORE_TIMEOUT_SECONDS = 60;
/** Lambda's hard limit on layers per function. */
const MAX_LAYERS = 5;
/** How long to poll for `LastUpdateStatus === 'Successful'` before giving up. */
const UPDATE_POLL_TIMEOUT_MS = 60_000;
const UPDATE_POLL_INTERVAL_MS = 2_000;

export interface StartRemoteDebugSessionOptions {
  region: string;
  credentials: AwsCredentialIdentityProvider | AwsCredentialIdentity;
  /** Function name or ARN. The session publishes and debugs a dedicated
   * version of it; `$LATEST` is mutated only briefly, to be snapshotted. */
  functionName: string;
  /** Local TCP port for the debugger; 0/undefined picks an ephemeral port. */
  port?: number;
  /**
   * Full layer-version ARN to attach instead of the built-in per-region LDK
   * layer (see {@link getDebugLayerArn}'s `override` parameter).
   */
  layerArnOverride?: string;
  onProgress?: (msg: string) => void;
}

export interface RemoteDebugHandle {
  /** Local TCP port the tunnel proxy is listening on — attach a DAP client
   * (`request: 'attach', port`) here. */
  port: number;
  /** The version this session published and debugs (e.g. `"7"`). Every
   * invoke targets it, so a durable execution's replays stay pinned to the
   * one sandbox the debugger is attached to. */
  functionQualifier: string;
  /**
   * Synchronously invokes the published debug version. Blocks for as
   * long as the user is paused at breakpoints (up to the 900s timeout), so
   * callers should not await this on a UI-critical path. `executionName`
   * (optional) becomes the durable execution's idempotency name — same
   * semantics as `aws lambda invoke --durable-execution-name`.
   */
  invoke(
    payloadJson: string,
    executionName?: string,
  ): Promise<{
    statusCode?: number;
    /** UTF-8 decoded response payload (JSON text, or an error document). */
    payload: string;
    /** Base64-decoded `LogResult` tail (last ≤4 KB of logs), when present. */
    logTail?: string;
  }>;
  /**
   * Tears the session down: stops the proxy, closes+deletes the tunnel, and
   * optionally deletes the published debug version. `$LATEST` needs no
   * restoring here — it was reverted during setup, seconds after the version
   * was published.
   *
   * `deleteVersion` defaults to FALSE, and that default is deliberate: a
   * durable execution PINS the version it started on, so deleting it while
   * the execution is still in flight (suspended at a wait, say) makes the
   * resuming invocation fail and takes the user's execution down with it.
   * Only pass `true` once the execution has actually finished. When left
   * false the version survives and its number is reported via `onProgress`,
   * so it can be cleaned up deliberately.
   *
   * Each step is best-effort and this NEVER throws (failures are aggregated
   * into a single console.warn) — a cleanup path that throws would mask the
   * error that triggered the cleanup. Idempotent: subsequent calls are no-ops.
   */
  dispose(opts?: { deleteVersion?: boolean }): Promise<void>;
}

/** The exact pre-debug configuration restored by dispose(). */
interface ConfigSnapshot {
  timeout: number | undefined;
  /** Layer-version ARNs, in original order. */
  layers: string[];
  environment: Record<string, string>;
}

const errMessage = (e: unknown): string =>
  (e as { message?: string } | undefined)?.message ?? String(e);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls until the function's `LastUpdateStatus` is `Successful`. Lambda
 * applies configuration updates asynchronously — invoking (or updating
 * again, as dispose() does) while an update is still `InProgress` fails
 * with ResourceConflictException, so every mutation here waits it out.
 */
async function waitForUpdateSuccessful(
  lambda: LambdaClient,
  functionName: string,
): Promise<void> {
  const deadline = Date.now() + UPDATE_POLL_TIMEOUT_MS;
  for (;;) {
    const config = await lambda.send(
      new GetFunctionConfigurationCommand({ FunctionName: functionName }),
    );
    if (config.LastUpdateStatus === "Successful") return;
    if (config.LastUpdateStatus === "Failed") {
      throw new Error(
        `Function update failed: ${config.LastUpdateStatusReason ?? "unknown reason"}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for function update to complete (LastUpdateStatus=${config.LastUpdateStatus}).`,
      );
    }
    await sleep(UPDATE_POLL_INTERVAL_MS);
  }
}

/**
 * Starts a remote debug session against a Node.js Lambda function by
 * publishing a dedicated debug version of it. See the module doc comment for
 * the full mechanism; the returned handle's `dispose()` MUST be called (even
 * on failure paths in the caller) or the tunnel and the published version are
 * left behind — though as a safety net, failures INSIDE this function undo
 * everything already done before rethrowing.
 */
export async function startRemoteDebugSession(
  opts: StartRemoteDebugSessionOptions,
): Promise<RemoteDebugHandle> {
  const { region, credentials, functionName, onProgress } = opts;
  const lambda = new LambdaClient({ region, credentials });
  const iot = new IoTSecureTunnelingClient({ region, credentials });

  // ---- (1) Snapshot the current configuration BEFORE any mutation. ------
  onProgress?.("Reading function configuration…");
  const config: FunctionConfiguration = await lambda.send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName }),
  );

  const runtime = config.Runtime ?? "";
  if (!runtime.startsWith("nodejs")) {
    throw new Error(
      `Remote debugging supports Node.js runtimes only; ${functionName} uses "${runtime}".`,
    );
  }

  const existingLayers = (config.Layers ?? [])
    .map((l) => l.Arn)
    .filter((a): a is string => !!a);

  // A previous debug session that was killed (process exit, cancelled test,
  // crashed extension host) leaves its layer + env mutations behind — a
  // REAL scenario hit during this module's own development. Build the
  // snapshot from the config AS IF that session had reverted properly:
  // strip any LDK debug layer (matched by name, any version/account — the
  // layer table can change) and the debug env vars, restoring a preserved
  // ORIGINAL_AWS_LAMBDA_EXEC_WRAPPER if one was stashed. This makes setup
  // idempotent (no duplicate-layer error) AND makes dispose() restore the
  // truly-clean config instead of re-persisting the leftovers forever.
  const isDebugLayer = (arn: string) =>
    /:layer:LDKLayer(X86|Arm64):\d+$/.test(arn);
  const cleanLayers = existingLayers.filter((a) => !isDebugLayer(a));
  const leftoverDetected = cleanLayers.length !== existingLayers.length;
  if (leftoverDetected) {
    onProgress?.(
      "Found leftover debug configuration from a previous session — will restore a clean config on teardown.",
    );
  }
  const rawEnv = { ...(config.Environment?.Variables ?? {}) };
  const cleanEnv: Record<string, string> = { ...rawEnv };
  if (leftoverDetected || rawEnv.AWS_LDK_DESTINATION_TOKEN) {
    delete cleanEnv.AWS_LDK_DESTINATION_TOKEN;
    delete cleanEnv.AWS_LAMBDA_DEBUG_ON_LATEST;
    if (cleanEnv.ORIGINAL_AWS_LAMBDA_EXEC_WRAPPER) {
      cleanEnv.AWS_LAMBDA_EXEC_WRAPPER =
        cleanEnv.ORIGINAL_AWS_LAMBDA_EXEC_WRAPPER;
      delete cleanEnv.ORIGINAL_AWS_LAMBDA_EXEC_WRAPPER;
    } else if (cleanEnv.AWS_LAMBDA_EXEC_WRAPPER === "/opt/bin/ldk_wrapper") {
      delete cleanEnv.AWS_LAMBDA_EXEC_WRAPPER;
    }
  }

  // Lambda rejects a 6th layer, and unlike the toolkit we don't silently
  // reuse an already-attached LDK layer — a leftover layer from a crashed
  // session means a leftover config we should not build on top of.
  if (cleanLayers.length >= MAX_LAYERS) {
    throw new Error(
      `${functionName} already has ${MAX_LAYERS} layers attached — Lambda's maximum. Remove one to enable remote debugging.`,
    );
  }

  // The snapshot is what dispose() restores VERBATIM. Held only in memory:
  // this module has no vscode globalState (crash recovery is a caller
  // concern in v1). Note it's the SANITIZED config — see above.
  // Timeout: a leftover session also set it to DEBUG_TIMEOUT_SECONDS and the
  // original is unknowable — restore a sane default instead of persisting
  // the debug value forever. Any other value is the user's own; keep it.
  const snapshot: ConfigSnapshot = {
    timeout:
      leftoverDetected && config.Timeout === DEBUG_TIMEOUT_SECONDS
        ? DEFAULT_RESTORE_TIMEOUT_SECONDS
        : config.Timeout,
    layers: cleanLayers,
    environment: cleanEnv,
  };

  // Toolkit parity: prefer x86_64 when the function reports it (or reports
  // nothing — x86_64 is Lambda's default architecture).
  const arch: "x86_64" | "arm64" = config.Architectures?.includes("arm64")
    ? "arm64"
    : "x86_64";
  const layerArn = getDebugLayerArn(region, arch, opts.layerArnOverride);
  if (!layerArn) {
    throw new Error(
      `No debug layer is published in ${region}. Pass layerArnOverride to use a custom layer.`,
    );
  }

  // ---- (2) Open the tunnel FIRST — the destination token must exist ------
  // before the function config can reference it, and an open-tunnel failure
  // this early means nothing needs reverting.
  onProgress?.("Opening secure tunnel…");
  const tunnel = await iot.send(
    new OpenTunnelCommand({
      description: "WorkflowStudioDebug",
      // 12h — the tunnel outliving the debug session is fine (dispose()
      // closes it), but a tunnel DYING mid-session kills the debugger.
      timeoutConfig: { maxLifetimeTimeoutMinutes: 720 },
      // Single service "WSS" — must match the serviceId the proxy stamps on
      // outgoing frames (it learns it from the SERVICE_IDS handshake).
      destinationConfig: { services: ["WSS"] },
    }),
  );
  const { tunnelId, sourceAccessToken, destinationAccessToken } = tunnel;
  if (!tunnelId || !sourceAccessToken || !destinationAccessToken) {
    throw new Error("OpenTunnel returned an incomplete response.");
  }

  // Best-effort teardown for failure paths below (before the handle — and
  // its full dispose() — exists). Ordering mirrors dispose().
  const revertLatest = async (): Promise<void> => {
    await lambda.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Timeout: snapshot.timeout,
        Layers: snapshot.layers,
        Environment: { Variables: snapshot.environment },
      }),
    );
    await waitForUpdateSuccessful(lambda, functionName);
  };

  const revertOnFailure = async (
    latestNeedsRevert: boolean,
    publishedVersion: string | undefined,
  ) => {
    const problems: string[] = [];
    if (latestNeedsRevert) {
      try {
        await revertLatest();
      } catch (e) {
        problems.push(`config revert failed: ${errMessage(e)}`);
      }
    }
    // Safe to delete unconditionally here: setup failed, so no execution was
    // ever started against this version.
    if (publishedVersion) {
      try {
        await lambda.send(
          new DeleteFunctionCommand({
            FunctionName: functionName,
            Qualifier: publishedVersion,
          }),
        );
      } catch (e) {
        problems.push(
          `debug version ${publishedVersion} delete failed: ${errMessage(e)}`,
        );
      }
    }
    try {
      await iot.send(new CloseTunnelCommand({ tunnelId, delete: true }));
    } catch (e) {
      problems.push(`tunnel close failed: ${errMessage(e)}`);
    }
    if (problems.length > 0) {
      console.warn(
        `Remote debug setup cleanup issues (function may need manual restore): ${problems.join("; ")}`,
      );
    }
  };

  // ---- (3) Mutate $LATEST, snapshot it into a version, restore $LATEST. --
  let latestNeedsRevert = false;
  let version: string | undefined;
  let proxy: LocalTunnelProxy | undefined;
  try {
    onProgress?.("Attaching debug layer to function…");
    const updatedEnv: Record<string, string> = {
      ...snapshot.environment,
      // The layer's wrapper script: starts the runtime inspector and the
      // tunnel destination agent, then chains to the real runtime.
      AWS_LAMBDA_EXEC_WRAPPER: "/opt/bin/ldk_wrapper",
      AWS_LDK_DESTINATION_TOKEN: destinationAccessToken,
      // Deliberately NOT setting AWS_LAMBDA_DEBUG_ON_LATEST: the session
      // debugs a published version, which is what earns it a dedicated
      // sandbox (see the module doc comment).
    };
    // Don't clobber a user's own exec wrapper — the LDK wrapper chains to
    // whatever this records once it's done with its own bootstrap.
    if (snapshot.environment["AWS_LAMBDA_EXEC_WRAPPER"]) {
      updatedEnv.ORIGINAL_AWS_LAMBDA_EXEC_WRAPPER =
        snapshot.environment["AWS_LAMBDA_EXEC_WRAPPER"];
    }

    await lambda.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Timeout: DEBUG_TIMEOUT_SECONDS,
        Layers: [...snapshot.layers, layerArn],
        Environment: { Variables: updatedEnv },
      }),
    );
    latestNeedsRevert = true;
    await waitForUpdateSuccessful(lambda, functionName);

    onProgress?.("Publishing a debug version…");
    const published = await lambda.send(
      new PublishVersionCommand({
        FunctionName: functionName,
        Description: "Workflow Studio remote debug session",
      }),
    );
    if (!published.Version) {
      throw new Error("PublishVersion returned no version number.");
    }
    version = published.Version;

    // Restore $LATEST straight away: the debug configuration now lives in the
    // immutable version, so leaving it on $LATEST would expose unrelated
    // traffic to the debug layer for the whole session for no benefit.
    onProgress?.(`Published version ${version}; restoring $LATEST…`);
    await revertLatest();
    latestNeedsRevert = false;

    // ---- (4) Start the local tunnel proxy (SOURCE side). ----------------
    onProgress?.("Starting local tunnel proxy…");
    proxy = new LocalTunnelProxy({
      region,
      sourceAccessToken,
      port: opts.port,
    });
    const port = await proxy.start();
    onProgress?.(`Debugger port ready on 127.0.0.1:${port}.`);

    // ---- (5)/(6) The live session handle. --------------------------------
    let disposed = false;
    const debugVersion = version;
    return {
      port,
      functionQualifier: debugVersion,

      async invoke(payloadJson: string, executionName?: string) {
        const response = await lambda.send(
          new InvokeCommand({
            FunctionName: functionName,
            // The published debug version — the ONLY qualifier carrying the
            // debug layer, and the one whose sandbox the debugger is attached
            // to. Durable executions pin it, so replays come back here.
            Qualifier: debugVersion,
            // Tail = last 4KB of logs come back base64 in LogResult, so the
            // caller can show output without a CloudWatch round-trip.
            LogType: "Tail",
            // Default RequestResponse (synchronous) on purpose: the call
            // must hold the sandbox open while the user steps through
            // breakpoints.
            Payload: Buffer.from(payloadJson, "utf-8"),
            ...(executionName?.trim()
              ? { DurableExecutionName: executionName.trim() }
              : {}),
          }),
        );
        return {
          statusCode: response.StatusCode,
          payload: Buffer.from(response.Payload ?? new Uint8Array()).toString(
            "utf-8",
          ),
          logTail: response.LogResult
            ? Buffer.from(response.LogResult, "base64").toString("utf-8")
            : undefined,
        };
      },

      async dispose(disposeOpts?: { deleteVersion?: boolean }) {
        // Idempotent: a double dispose (e.g. caller cleanup racing a
        // process-exit hook) must not re-run cleanup against a function
        // someone may have already started a NEW session on.
        if (disposed) return;
        disposed = true;
        const problems: string[] = [];

        // Proxy first: kill the local port so no debugger reconnects while
        // the rest is being torn down underneath it.
        try {
          proxy?.dispose();
        } catch (e) {
          problems.push(`proxy dispose failed: ${errMessage(e)}`);
        }

        // $LATEST was already restored during setup. Deleting the version is
        // opt-in because a durable execution pins it — see the interface doc.
        if (disposeOpts?.deleteVersion) {
          try {
            onProgress?.(`Deleting debug version ${debugVersion}…`);
            await lambda.send(
              new DeleteFunctionCommand({
                FunctionName: functionName,
                Qualifier: debugVersion,
              }),
            );
          } catch (e) {
            problems.push(
              `debug version ${debugVersion} delete failed: ${errMessage(e)}`,
            );
          }
        } else {
          onProgress?.(
            `Leaving debug version ${debugVersion} in place (the execution may still resume onto it); delete it manually once the execution has finished.`,
          );
        }

        // delete:true — a closed-but-undeleted tunnel still counts against
        // the account's open-tunnel quota until it ages out.
        try {
          await iot.send(new CloseTunnelCommand({ tunnelId, delete: true }));
        } catch (e) {
          problems.push(`tunnel close failed: ${errMessage(e)}`);
        }

        // NEVER throw from dispose: it runs on error paths where throwing
        // would mask the original failure, and on teardown paths where
        // nobody can act on it. Aggregate instead.
        if (problems.length > 0) {
          console.warn(
            `Remote debug session cleanup issues (function ${functionName}, debug version ${debugVersion}): ${problems.join("; ")}`,
          );
        }
      },
    };
  } catch (e) {
    // Failure between mutation and handle creation: undo what happened.
    try {
      proxy?.dispose();
    } catch {
      /* best-effort */
    }
    await revertOnFailure(latestNeedsRevert, version);
    throw e;
  }
}
