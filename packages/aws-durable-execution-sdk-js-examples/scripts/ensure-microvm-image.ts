#!/usr/bin/env node
// Builds the MicroVM image that the MicroVM examples run, or reuses it.
//
// The script bundles microvm-image/app.ts with the worker package, zips the
// bundle with the Dockerfile, uploads the zip, and calls CreateMicrovmImage.
// The image name ends with a hash of the bundle, the Dockerfile, and the
// CreateMicrovmImage settings. So a run with unchanged inputs finds the image
// and skips the build. A change to the worker, the app, or a setting builds a
// new image.
//
// It writes the image ARN and the MicroVM execution role ARN as JSON to the
// file named by --output. The integration test passes both to the SAM
// template, which sets them as environment variables of the MicroVM
// examples.
//
// The resource names come from the language testing stack in the test
// account. That stack names them after the account and Region. Environment
// variables override them for another account:
//   MICROVM_ARTIFACT_BUCKET       the bucket for the image code zip
//   MICROVM_IMAGE_BUILD_ROLE_ARN  the role that the image build assumes
//   MICROVM_EXECUTION_ROLE_ARN    the role that a running MicroVM assumes
//
// Usage:
//   TEST_ACCOUNT_ID=123456789012 AWS_REGION=us-east-1 \
//     npm run ensure-microvm-image -- --output image.json

import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  CreateMicrovmImageCommand,
  DeleteMicrovmImageCommand,
  GetMicrovmImageCommand,
  type Hooks,
  LambdaMicrovmsClient,
  ResourceNotFoundException,
  ValidationException,
} from "@aws-sdk/client-lambda-microvms";
import { build } from "esbuild";

const IMAGE_DIR = path.join(__dirname, "../microvm-image");
const OUT_DIR = path.join(__dirname, "../.microvm-image-build");
const IMAGE_NAME_PREFIX = "sdk-js-examples";
const POLL_INTERVAL_MS = 10_000;
const BUILD_TIMEOUT_MS = 20 * 60_000;

// GetMicrovmImage reports an image as missing for a short time after
// CreateMicrovmImage returns. A test run saw this for one 10-second poll.
// A create in that time would fail on the duplicate name. So the script
// waits this long before it creates again.
const CREATE_VISIBILITY_MS = 60_000;

// The worker answers the ready hook at image build and the run hook at each
// launch. The service requires the ready hook whenever a lifecycle hook is
// enabled. The resume hook lets a session's worker accept jobs again after it
// suspended its own MicroVM. On the suspend hook the worker refuses new jobs,
// and on the terminate hook it fails the callbacks of running jobs. A
// terminate hook gets 10 seconds, because the worker reports before it
// answers.
const IMAGE_HOOKS: Hooks = {
  port: 8080,
  microvmHooks: {
    run: "ENABLED",
    runTimeoutInSeconds: 10,
    resume: "ENABLED",
    resumeTimeoutInSeconds: 10,
    suspend: "ENABLED",
    suspendTimeoutInSeconds: 10,
    terminate: "ENABLED",
    terminateTimeoutInSeconds: 10,
  },
  microvmImageHooks: { ready: "ENABLED", readyTimeoutInSeconds: 60 },
};

/** The CreateMicrovmImage settings other than the name and the code. */
export interface ImageSettings {
  baseImageArn: string;
  buildRoleArn: string;
  egressNetworkConnectors: string[];
  hooks: Hooks;
}

/** The image operations that {@link ensureImage} needs. */
export interface ImageService {
  /** Returns the image, or undefined when the image does not exist. */
  get(): Promise<
    { state?: string; latestActiveImageVersion?: string } | undefined
  >;
  /** Uploads the code and calls CreateMicrovmImage. */
  create(): Promise<void>;
  /** Calls DeleteMicrovmImage. */
  delete(): Promise<void>;
}

export interface EnsureImageOptions {
  name: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

/**
 * Waits until the image has an active version, and creates it when needed.
 * Returns the active version.
 *
 * It acts on each state that GetMicrovmImage reports:
 * - CREATED or UPDATED with an active version: the image is ready.
 * - Missing or DELETED: it creates the image.
 * - CREATING, UPDATING, or DELETING: it waits.
 * - CREATE_FAILED: it deletes the image, then creates it again. It does this
 *   once per run, because a second failure most likely has the same cause.
 * - DELETE_FAILED, UPDATE_FAILED, or another state: it throws. Only an
 *   administrator of the account can clear these states.
 *
 * The image name carries a hash of the inputs. So a failed build fails every
 * later run with the same inputs, until the failed image is deleted. The
 * delete and the recreate let a run recover from a failure that does not
 * repeat, such as a timeout of the ready hook, without an administrator.
 */
export async function ensureImage(
  service: ImageService,
  options: EnsureImageOptions,
): Promise<string> {
  const {
    name,
    timeoutMs = BUILD_TIMEOUT_MS,
    pollIntervalMs = POLL_INTERVAL_MS,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console.log,
  } = options;
  const logGroup = `/aws/lambda-microvms/${name}`;
  const deadline = now() + timeoutMs;
  let deletedFailedImage = false;
  let createdAfterDelete = false;
  let creates = 0;
  let lastCreateAt: number | undefined;
  let firstPoll = true;

  for (;;) {
    const image = await service.get();
    const state = image?.state ?? "NOT_FOUND";

    switch (state) {
      case "CREATED":
      case "UPDATED":
        if (image?.latestActiveImageVersion) {
          log(
            firstPoll
              ? `Reusing MicroVM image ${name}, version ${image.latestActiveImageVersion}`
              : `MicroVM image ${name} is ${state}, version ${image.latestActiveImageVersion}`,
          );
          return image.latestActiveImageVersion;
        }
        break;

      case "NOT_FOUND":
      case "DELETED": {
        const createIsRecent =
          lastCreateAt !== undefined &&
          now() - lastCreateAt < CREATE_VISIBILITY_MS;
        if (createIsRecent) {
          break;
        }
        // One create at the start and one after a failed build.
        if (creates >= 2) {
          throw new Error(
            `MicroVM image ${name} is still ${state} after ${creates} CreateMicrovmImage calls`,
          );
        }
        log(`Creating MicroVM image ${name}`);
        await service.create();
        creates++;
        lastCreateAt = now();
        createdAfterDelete = deletedFailedImage;
        break;
      }

      case "CREATING":
      case "UPDATING":
      case "DELETING":
        break;

      case "CREATE_FAILED":
        // GetMicrovmImage may still report the failed image right after
        // DeleteMicrovmImage returns. So the state counts as a second failure
        // only after the rebuild started.
        if (deletedFailedImage && !createdAfterDelete) {
          break;
        }
        if (deletedFailedImage) {
          throw new Error(
            `MicroVM image ${name} failed to build again after a rebuild. ` +
              `Read the build logs in the ${logGroup} log group.`,
          );
        }
        log(
          `MicroVM image ${name} is CREATE_FAILED. Deleting it to build it again. ` +
            `The build logs are in the ${logGroup} log group.`,
        );
        await service.delete();
        deletedFailedImage = true;
        lastCreateAt = undefined;
        break;

      default:
        throw new Error(
          `MicroVM image ${name} is ${state}. The script does not clear this ` +
            "state. An administrator of the test account must delete the " +
            `image. Read the logs in the ${logGroup} log group.`,
        );
    }

    firstPoll = false;
    if (now() > deadline) {
      throw new Error(
        `MicroVM image ${name} is still ${state} after ${timeoutMs / 60_000} minutes`,
      );
    }
    log(`Waiting for MicroVM image ${name}: ${state}`);
    await sleep(pollIntervalMs);
  }
}

function getArgValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/**
 * Warns when the functions use a Lambda endpoint other than the default one.
 * The worker in the MicroVM sends its callbacks to the default endpoint of
 * the Region. So an execution on another endpoint never receives them, and
 * the MicroVM tests time out.
 */
function warnOnCustomLambdaEndpoint(region: string): void {
  const endpoint = process.env.LAMBDA_ENDPOINT;
  if (!endpoint) {
    return;
  }
  const defaultEndpoint = `https://lambda.${region}.amazonaws.com`;
  if (endpoint.replace(/\/+$/, "") !== defaultEndpoint) {
    // The value is not printed, because CI passes it as a secret.
    console.warn(
      `WARNING: LAMBDA_ENDPOINT is not ${defaultEndpoint}. The worker in ` +
        "the MicroVM sends its callbacks to the default endpoint. So the " +
        "MicroVM examples will time out.",
    );
  }
}

async function bundle(
  settings: ImageSettings,
): Promise<{ zip: Buffer; hash: string }> {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const appPath = path.join(OUT_DIR, "app.mjs");
  const dockerfilePath = path.join(OUT_DIR, "Dockerfile");

  // The app uses top-level await, so it is an ES module. The banner gives
  // bundled CommonJS dependencies a working require().
  await build({
    entryPoints: [path.join(IMAGE_DIR, "app.ts")],
    outfile: appPath,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: "warning",
  });
  writeFileSync(
    dockerfilePath,
    readFileSync(path.join(IMAGE_DIR, "Dockerfile")),
  );

  const zipPath = path.join(OUT_DIR, "microvm-image.zip");
  execFileSync("zip", ["-qj", zipPath, appPath, dockerfilePath]);

  // The Dockerfile names a floating node:22-alpine tag, and the hash does
  // not cover the image behind the tag. Lambda snapshots the image at build
  // time, so a tag change takes effect at the next build.
  const hash = createHash("sha256")
    .update(readFileSync(appPath))
    .update(readFileSync(dockerfilePath))
    .update(JSON.stringify(settings))
    .digest("hex")
    .slice(0, 12);
  // The zip is read once here. A rebuild uploads the same bytes, even if
  // another run has replaced the file since.
  return { zip: readFileSync(zipPath), hash };
}

export interface ImageServiceDeps {
  microvms: Pick<LambdaMicrovmsClient, "send">;
  s3: Pick<S3Client, "send">;
  name: string;
  imageArn: string;
  bucket: string;
  key: string;
  zip: Buffer;
  settings: ImageSettings;
}

/** Creates the {@link ImageService} that calls S3 and the MicroVMs API. */
export function createImageService(deps: ImageServiceDeps): ImageService {
  const {
    microvms: client,
    s3,
    name,
    imageArn,
    bucket,
    key,
    zip,
    settings,
  } = deps;
  const service: ImageService = {
    get: async () => {
      try {
        return await client.send(
          new GetMicrovmImageCommand({ imageIdentifier: imageArn }),
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundException) {
          return undefined;
        }
        throw error;
      }
    },
    create: async () => {
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: zip,
          }),
        );
      } catch (error) {
        // PutObject does not model NoSuchBucket, so the client throws a
        // generic S3 exception with that name.
        if ((error as { name?: string }).name === "NoSuchBucket") {
          throw new Error(
            `The bucket ${bucket} does not exist. The MicroVM examples need ` +
              "the MicroVM resources of the language testing stack. For " +
              "another account, set MICROVM_ARTIFACT_BUCKET, " +
              "MICROVM_IMAGE_BUILD_ROLE_ARN, and MICROVM_EXECUTION_ROLE_ARN.",
          );
        }
        throw error;
      }
      try {
        await client.send(
          new CreateMicrovmImageCommand({
            name,
            description:
              "The MicroVM image that the durable execution SDK examples run",
            codeArtifact: { uri: `s3://${bucket}/${key}` },
            ...settings,
          }),
        );
      } catch (error) {
        // The integration tests of several Node.js versions run at the same
        // time and build the same image. The service rejects the second
        // create with a ValidationException, because the name exists. The
        // image is then the one this run needs, because its name carries the
        // hash of the inputs. So the run waits for it.
        //
        // GetMicrovmImage can still report the new image as missing. So the
        // error message is the first signal, and the image state the second.
        const nameExists =
          error instanceof ValidationException &&
          /already exists/.test(error.message);
        if (nameExists || (await service.get())) {
          console.log(`MicroVM image ${name} was created by another run`);
          return;
        }
        throw error;
      }
    },
    delete: async () => {
      try {
        await client.send(
          new DeleteMicrovmImageCommand({ imageIdentifier: imageArn }),
        );
      } catch (error) {
        // The integration tests of several Node.js versions can see the same
        // failed image and delete it at the same time. The later delete then
        // fails, because the image is gone or is being deleted. The poll
        // loop handles both states. So the run carries on when the image is
        // missing or DELETING after the error.
        const image = await service.get();
        if (image === undefined || image.state === "DELETING") {
          console.log(`MicroVM image ${name} was deleted by another run`);
          return;
        }
        throw error;
      }
    },
  };
  return service;
}

async function main() {
  const args = process.argv.slice(2);
  const outputPath = getArgValue(args, "--output");
  if (!outputPath) {
    throw new Error("--output is required");
  }

  const region = requireEnv("AWS_REGION");
  const account = requireEnv("TEST_ACCOUNT_ID");
  const bucket =
    process.env.MICROVM_ARTIFACT_BUCKET ??
    `microvm-image-artifacts-${account}-${region}`;
  const executionRoleArn =
    process.env.MICROVM_EXECUTION_ROLE_ARN ??
    `arn:aws:iam::${account}:role/microvm-execution`;
  const settings: ImageSettings = {
    baseImageArn: `arn:aws:lambda:${region}:aws:microvm-image:al2023-1`,
    buildRoleArn:
      process.env.MICROVM_IMAGE_BUILD_ROLE_ARN ??
      `arn:aws:iam::${account}:role/microvm-image-build`,
    // The build pulls the Node.js base image from Amazon ECR Public.
    egressNetworkConnectors: [
      `arn:aws:lambda:${region}:aws:network-connector:aws-network-connector:INTERNET_EGRESS`,
    ],
    hooks: IMAGE_HOOKS,
  };

  warnOnCustomLambdaEndpoint(region);

  const { zip, hash } = await bundle(settings);
  const name = `${IMAGE_NAME_PREFIX}-${hash}`;
  // GetMicrovmImage accepts only the image ARN, not the name.
  const imageArn = `arn:aws:lambda:${region}:${account}:microvm-image:${name}`;
  const service = createImageService({
    microvms: new LambdaMicrovmsClient({ region }),
    s3: new S3Client({ region }),
    name,
    imageArn,
    bucket,
    key: `examples/${name}.zip`,
    zip,
    settings,
  });

  await ensureImage(service, { name });

  writeFileSync(outputPath, JSON.stringify({ imageArn, executionRoleArn }));
  console.log(`Wrote ${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
