import assert from "node:assert/strict";
import test from "node:test";
import { hasUnrestrictedPublicStatement } from "./validate-public-policy.mjs";

const statementId = "public-layer-access";
const layerVersionArn = "arn:aws:lambda:us-east-1:123456789012:layer:example:1";

function policy(statement) {
  return {
    Version: "2012-10-17",
    Statement: [statement],
  };
}

test("accepts an unrestricted public layer permission", () => {
  assert.equal(
    hasUnrestrictedPublicStatement(
      policy({
        Sid: statementId,
        Effect: "Allow",
        Principal: "*",
        Action: "lambda:GetLayerVersion",
        Resource: layerVersionArn,
      }),
      statementId,
      layerVersionArn,
    ),
    true,
  );
});

test("accepts a public AWS principal in an action array", () => {
  assert.equal(
    hasUnrestrictedPublicStatement(
      policy({
        Sid: statementId,
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["lambda:GetLayerVersion"],
        Resource: [layerVersionArn],
      }),
      statementId,
      layerVersionArn,
    ),
    true,
  );
});

for (const [name, statement] of [
  [
    "another principal",
    {
      Sid: statementId,
      Effect: "Allow",
      Principal: { AWS: "123456789012" },
      Action: "lambda:GetLayerVersion",
      Resource: layerVersionArn,
    },
  ],
  [
    "an organization restriction",
    {
      Sid: statementId,
      Effect: "Allow",
      Principal: "*",
      Action: "lambda:GetLayerVersion",
      Resource: layerVersionArn,
      Condition: {
        StringEquals: { "aws:PrincipalOrgID": "o-example" },
      },
    },
  ],
  [
    "the wrong action",
    {
      Sid: statementId,
      Effect: "Allow",
      Principal: "*",
      Action: "lambda:InvokeFunction",
      Resource: layerVersionArn,
    },
  ],
  [
    "the wrong statement ID",
    {
      Sid: "other-statement",
      Effect: "Allow",
      Principal: "*",
      Action: "lambda:GetLayerVersion",
      Resource: layerVersionArn,
    },
  ],
  [
    "the wrong layer version",
    {
      Sid: statementId,
      Effect: "Allow",
      Principal: "*",
      Action: "lambda:GetLayerVersion",
      Resource: "arn:aws:lambda:us-east-1:123456789012:layer:example:2",
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    assert.equal(
      hasUnrestrictedPublicStatement(
        policy(statement),
        statementId,
        layerVersionArn,
      ),
      false,
    );
  });
}
