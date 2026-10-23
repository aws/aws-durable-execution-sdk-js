// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Wiring guards for the Durable Execution Telemetry conformance package.
 *
 * The handlers are deploy-only; the deployed conformance run validates the
 * exported record. What is testable here is the wiring: every function in the
 * template resolves to an exported handler, every handler is deployed, the
 * requirement coverage is complete, and the template honours the runner's
 * `TelemetryLogGroupName` parameter contract.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_ROOT = join(__dirname, "..");
const HANDLERS_ROOT = join(PACKAGE_ROOT, "handlers");

interface HandlerReference {
  module: string;
  exportName: string;
}

/** `Handler: telemetry_1_success.handler` -> `{ module, exportName }`. */
function handlerReferences(template: string): HandlerReference[] {
  return [...template.matchAll(/^\s*Handler:\s*(\S+)\s*$/gm)].map((match) => {
    const reference = match[1];
    const separator = reference.lastIndexOf(".");
    return {
      module: reference.slice(0, separator),
      exportName: reference.slice(separator + 1),
    };
  });
}

/** Requirement IDs listed under every function's `TestingMetadata.TestDescription`. */
function requirementIds(template: string): string[] {
  return [...template.matchAll(/^\s*-\s*(telemetry-[a-z-]*\d+)\s*$/gm)].map(
    (match) => match[1],
  );
}

function handlerSource(module: string): string {
  return readFileSync(join(HANDLERS_ROOT, `${module}.ts`), "utf8");
}

const template = readFileSync(join(PACKAGE_ROOT, "template.yaml"), "utf8");

describe("template handler references", () => {
  const references = handlerReferences(template);
  const handlerModules = readdirSync(HANDLERS_ROOT)
    .filter((file) => /^telemetry_\d+.*\.ts$/.test(file))
    .map((file) => file.replace(/\.ts$/, ""));

  it("finds a reference in every template function", () => {
    expect(references).toHaveLength(1);
  });

  it.each([
    ...new Set(references.map((ref) => `${ref.module}.${ref.exportName}`)),
  ])("%s resolves to an exported handler", (reference) => {
    const separator = reference.lastIndexOf(".");
    const module = reference.slice(0, separator);
    const exportName = reference.slice(separator + 1);

    expect(handlerModules).toContain(module);
    expect(handlerSource(module)).toMatch(
      new RegExp(`export const ${exportName}\\b`),
    );
  });

  it("deploys every handler module", () => {
    const referenced = new Set(references.map((ref) => ref.module));
    expect([...referenced].sort()).toEqual(handlerModules.sort());
  });
});

describe("requirement coverage", () => {
  it("covers the telemetry suite", () => {
    expect(requirementIds(template)).toEqual(["telemetry-1"]);
  });
});

describe("TelemetryLogGroupName contract", () => {
  it("declares the parameter the runner passes", () => {
    expect(template).toMatch(/^ {2}TelemetryLogGroupName:\n {4}Type: String/m);
  });

  it("creates the log group from the parameter before any function", () => {
    expect(template).toMatch(
      /Type: AWS::Logs::LogGroup\n\s+Properties:\n\s+LogGroupName: !Ref TelemetryLogGroupName/,
    );
    expect(template).toMatch(/DependsOn: TelemetryLogGroup$/m);
  });

  it("hands the group name to the handler through TELEMETRY_LOG_GROUP_NAME", () => {
    expect(template).toContain(
      "TELEMETRY_LOG_GROUP_NAME: !Ref TelemetryLogGroupName",
    );
    expect(handlerSource("telemetry_1_success")).toContain(
      "process.env.TELEMETRY_LOG_GROUP_NAME",
    );
  });
});
