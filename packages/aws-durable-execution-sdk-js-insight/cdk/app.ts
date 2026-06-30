#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LambdaClient, paginateListFunctions } from "@aws-sdk/client-lambda";
import { InsightDestinationsStack } from "./stack";
import * as config from "./config.json";

/**
 * Discover the execution-role ARNs of all durable functions in the account
 * by listing functions and checking for the native DurableConfig field.
 * Runs at synth time so the resolved ARNs can scope IAM/OpenSearch policies
 * precisely (no runtime Lambda / iam:PutRolePolicy needed).
 */
async function discoverDurableFunctionRoles(
  region?: string,
): Promise<string[]> {
  const client = new LambdaClient(region ? { region } : {});
  const roleArns = new Set<string>();
  for await (const page of paginateListFunctions({ client }, {})) {
    for (const fn of page.Functions ?? []) {
      // DurableConfig IS part of the FunctionConfiguration returned by
      // ListFunctions (see the documented Response Syntax for ListFunctions).
      // The API's "subset of fields" caveat only excludes State, StateReason,
      // StateReasonCode, LastUpdateStatus, LastUpdateStatusReason,
      // LastUpdateStatusReasonCode, and RuntimeVersionConfig — none of which
      // we depend on here. So filtering on DurableConfig is reliable and does
      // not require a per-function GetFunction call.
      if (fn.Role && fn.DurableConfig) {
        roleArns.add(fn.Role);
      }
    }
  }
  return Array.from(roleArns);
}

async function main(): Promise<void> {
  const app = new cdk.App();
  const region = process.env.CDK_DEFAULT_REGION;

  // Account and region are resolved from the AWS credentials/profile in use
  // when running `cdk synth`/`cdk deploy` (CDK CLI populates CDK_DEFAULT_*).
  // Override with `cdk deploy --region <region>` or AWS_REGION / AWS_PROFILE.
  let discoveredRoleArns: string[] = [];
  if (config.lambda.discoverDurableFunctions) {
    discoveredRoleArns = await discoverDurableFunctionRoles(region);
    console.log(
      `Discovered ${discoveredRoleArns.length} durable function role(s) at synth time.`,
    );
  }

  new InsightDestinationsStack(app, "InsightDestinationsStack", {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region,
    },
    discoveredRoleArns,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
