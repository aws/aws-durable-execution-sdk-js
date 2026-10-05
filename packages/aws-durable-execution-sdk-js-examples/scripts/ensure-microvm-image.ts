#!/usr/bin/env node
// Builds the MicroVM image that the MicroVM examples run, or reuses it.
//
// The script bundles microvm-image/app.ts with the worker package, zips the
// bundle with the Dockerfile, uploads the zip, and calls CreateMicrovmImage.
// The image name ends with a hash of the bundle, the Dockerfile, and the hook
// configuration. So a run with unchanged inputs finds the image and skips the
// build, and a change to the worker or the app builds a new image.
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
  ConflictException,
  CreateMicrovmImageCommand,
  GetMicrovmImageCommand,
  type Hooks,
  LambdaMicrovmsClient,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda-microvms";
import { build } from "esbuild";

const IMAGE_DIR = path.join(__dirname, "../microvm-image");
const OUT_DIR = path.join(__dirname, "../.microvm-image-build");
const IMAGE_NAME_PREFIX = "sdk-js-examples";
const POLL_INTERVAL_MS = 10_000;
const BUILD_TIMEOUT_MS = 20 * 60_000;

// The worker answers the ready hook at image build and the run hook at each
// launch. The service requires the ready hook whenever a lifecycle hook is
// enabled. The resume hook lets a session's worker accept jobs again after it
// suspended its own MicroVM.
const IMAGE_HOOKS: Hooks = {
  port: 8080,
  microvmHooks: {
    run: "ENABLED",
    runTimeoutInSeconds: 10,
    resume: "ENABLED",
    resumeTimeoutInSeconds: 10,
  },
  microvmImageHooks: { ready: "ENABLED", readyTimeoutInSeconds: 60 },
};

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

async function bundle(): Promise<{ zipPath: string; hash: string }> {
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

  const hash = createHash("sha256")
    .update(readFileSync(appPath))
    .update(readFileSync(dockerfilePath))
    .update(JSON.stringify(IMAGE_HOOKS))
    .digest("hex")
    .slice(0, 12);
  return { zipPath, hash };
}

async function getImage(client: LambdaMicrovmsClient, imageArn: string) {
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
  const buildRoleArn =
    process.env.MICROVM_IMAGE_BUILD_ROLE_ARN ??
    `arn:aws:iam::${account}:role/microvm-image-build`;
  const executionRoleArn =
    process.env.MICROVM_EXECUTION_ROLE_ARN ??
    `arn:aws:iam::${account}:role/microvm-execution`;

  const { zipPath, hash } = await bundle();
  const name = `${IMAGE_NAME_PREFIX}-${hash}`;
  // GetMicrovmImage accepts only the image ARN, not the name.
  const imageArn = `arn:aws:lambda:${region}:${account}:microvm-image:${name}`;
  const client = new LambdaMicrovmsClient({ region });

  if (await getImage(client, imageArn)) {
    console.log(`Reusing MicroVM image ${name}`);
  } else {
    const key = `examples/${name}.zip`;
    await new S3Client({ region }).send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: readFileSync(zipPath),
      }),
    );
    console.log(`Creating MicroVM image ${name}`);
    try {
      await client.send(
        new CreateMicrovmImageCommand({
          name,
          // The integration tests of several Node.js versions run at the same
          // time and build the same image. The same token makes their
          // requests one request.
          clientToken: name,
          description:
            "The MicroVM image that the durable execution SDK examples run",
          codeArtifact: { uri: `s3://${bucket}/${key}` },
          baseImageArn: `arn:aws:lambda:${region}:aws:microvm-image:al2023-1`,
          buildRoleArn,
          // The build pulls the Node.js base image from Amazon ECR Public.
          egressNetworkConnectors: [
            `arn:aws:lambda:${region}:aws:network-connector:aws-network-connector:INTERNET_EGRESS`,
          ],
          hooks: IMAGE_HOOKS,
        }),
      );
    } catch (error) {
      // Another run created an image with this name first. The image is the
      // one this run needs, because its name carries the hash of the inputs.
      if (!(error instanceof ConflictException)) {
        throw error;
      }
      console.log(`MicroVM image ${name} is being created by another run`);
    }
  }

  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  for (;;) {
    const image = await getImage(client, imageArn);
    const state = image?.state ?? "NOT_FOUND";
    if (
      (state === "CREATED" || state === "UPDATED") &&
      image?.latestActiveImageVersion
    ) {
      console.log(
        `MicroVM image ${name} is ${state}, version ${image.latestActiveImageVersion}`,
      );
      break;
    }
    if (state.endsWith("FAILED")) {
      // A failed image keeps its name. The next run with the same inputs
      // would find it and fail again. So delete it before a retry.
      throw new Error(
        `MicroVM image ${name} is ${state}. Read the build logs in the ` +
          `/aws/lambda-microvms/${name} log group. Delete the image with ` +
          `"aws lambda-microvms delete-microvm-image --image-identifier ${imageArn}" ` +
          "before the next run.",
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `MicroVM image ${name} is still ${state} after ${BUILD_TIMEOUT_MS / 60_000} minutes`,
      );
    }
    console.log(`Waiting for MicroVM image ${name}: ${state}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  writeFileSync(outputPath, JSON.stringify({ imageArn, executionRoleArn }));
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
