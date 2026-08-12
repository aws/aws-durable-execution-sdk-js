#!/usr/bin/env node

import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function includesValue(value, expected) {
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}

export function hasUnrestrictedPublicStatement(
  policy,
  statementId,
  layerVersionArn,
) {
  const statements = Array.isArray(policy?.Statement)
    ? policy.Statement
    : [policy?.Statement].filter(Boolean);

  return statements.some(
    (statement) =>
      statement?.Sid === statementId &&
      statement.Effect === "Allow" &&
      includesValue(statement.Action, "lambda:GetLayerVersion") &&
      (statement.Principal === "*" ||
        statement.Principal?.AWS === "*" ||
        includesValue(statement.Principal?.AWS, "*")) &&
      includesValue(statement.Resource, layerVersionArn) &&
      statement.Condition == null,
  );
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const statementId = process.argv[2];
  const layerVersionArn = process.argv[3];
  if (
    statementId == null ||
    layerVersionArn == null ||
    process.argv.length !== 4
  ) {
    console.error(
      "Usage: validate-public-policy.mjs <statement-id> <layer-version-arn> < policy.json",
    );
    process.exit(2);
  }

  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  try {
    const policy = JSON.parse(input);
    if (!hasUnrestrictedPublicStatement(policy, statementId, layerVersionArn)) {
      console.error(
        `Policy statement '${statementId}' is not an unrestricted public layer grant.`,
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(`Unable to parse layer policy: ${error.message}`);
    process.exit(1);
  }
}
