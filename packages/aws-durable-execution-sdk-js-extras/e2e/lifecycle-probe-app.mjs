// The application in the image that probe-lifecycle.mjs builds. It is not
// the worker. It records every request it receives, so that the probe can
// read from the MicroVM's log stream when and how Lambda calls each
// lifecycle hook.
//
// On the suspend and terminate hooks it also makes one outbound Lambda API
// call, and answers only after HOOK_DELAY_MS. The call shows whether the
// network and the credentials still work during the hook. The delay shows
// whether Lambda waits for the answer.
import { createServer } from "node:http";
import {
  LambdaClient,
  SendDurableExecutionCallbackHeartbeatCommand,
} from "@aws-sdk/client-lambda";
import {
  LambdaMicrovmsClient,
  SuspendMicrovmCommand,
} from "@aws-sdk/client-lambda-microvms";

const HOOK_PREFIX = "/aws/lambda-microvms/runtime/v1/";
const HOOK_DELAY_MS = 8_000;
const started = Date.now();
let microvmId = "unknown";
let region = process.env.AWS_REGION ?? "us-east-1";

const log = (event, data = {}) =>
  console.log(
    JSON.stringify({
      probe: event,
      at: new Date().toISOString(),
      uptimeMs: Date.now() - started,
      microvmId,
      ...data,
    }),
  );

// A line every second shows when the process stops running: at a freeze,
// at a terminate, or not at all.
let tick = 0;
setInterval(() => log("tick", { tick: tick++ }), 1_000).unref();

async function outboundCall() {
  const t0 = Date.now();
  const client = new LambdaClient({ region });
  try {
    await client.send(
      new SendDurableExecutionCallbackHeartbeatCommand({
        CallbackId: "probe-not-a-real-callback-id",
      }),
      { abortSignal: AbortSignal.timeout(5_000) },
    );
    return { ok: true, ms: Date.now() - t0 };
  } catch (error) {
    // Any answer from the service shows that the network and the credentials
    // work. A timeout or a connection error shows that they do not.
    return {
      ok: false,
      ms: Date.now() - t0,
      name: error?.name,
      status: error?.$metadata?.httpStatusCode,
      message: String(error?.message ?? error).slice(0, 160),
    };
  } finally {
    client.destroy();
  }
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(""));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

createServer(async (request, response) => {
  const path = (request.url ?? "").split("?")[0];
  const body = await readBody(request);
  const headers = {
    host: request.headers.host,
    requestId: request.headers["x-amzn-requestid"],
    userAgent: request.headers["user-agent"],
    contentType: request.headers["content-type"],
  };
  log("request", {
    method: request.method,
    path,
    headers,
    remote: request.socket.remoteAddress,
    body: body.slice(0, 600),
  });

  if (path === `${HOOK_PREFIX}run`) {
    try {
      const parsed = JSON.parse(body);
      microvmId = parsed.microvmId ?? microvmId;
      const payload = parsed.runHookPayload
        ? JSON.parse(parsed.runHookPayload)
        : undefined;
      region = payload?.region ?? region;
    } catch {
      // The log line above has the body.
    }
    response.writeHead(200).end("{}");
    return;
  }

  if (path === `${HOOK_PREFIX}suspend` || path === `${HOOK_PREFIX}terminate`) {
    const hook = path.slice(HOOK_PREFIX.length);
    const call = await outboundCall();
    log(`${hook}-outbound`, call);
    await sleep(HOOK_DELAY_MS);
    log(`${hook}-answering`, { afterMs: HOOK_DELAY_MS });
    response.writeHead(200).end("{}");
    log(`${hook}-answered`);
    return;
  }

  if (path === "/self-suspend") {
    const client = new LambdaMicrovmsClient({ region });
    try {
      await client.send(
        new SuspendMicrovmCommand({ microvmIdentifier: microvmId }),
      );
      log("self-suspend-returned");
      response.writeHead(200).end("{}");
    } catch (error) {
      log("self-suspend-failed", {
        name: error?.name,
        message: error?.message,
      });
      response.writeHead(500).end("{}");
    } finally {
      client.destroy();
    }
    return;
  }

  response.writeHead(200).end(JSON.stringify({ microvmId, tick }));
}).listen(8080, () => log("listening"));
