// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Wiring guards for the OTel conformance package.
 *
 * The conformance repo has an equivalent contract test for its own bundled
 * examples/javascript (tests/test_javascript_examples.py), but it asserts against paths in
 * that repo, so it cannot cover this copy. These tests replace it: they check that every
 * function the templates deploy resolves to a handler that exists, that the requirement
 * coverage is complete, and that the workflow still aims the shared orchestrator here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_DIR = "aws-durable-execution-sdk-js-conformance-tests-otel";
const PACKAGE_ROOT = join(__dirname, "..");
const HANDLERS_ROOT = join(PACKAGE_ROOT, "handlers");
const WORKFLOW_PATH = join(
  PACKAGE_ROOT,
  "..",
  "..",
  ".github",
  "workflows",
  "otel-conformance-tests.yml",
);

interface HandlerReference {
  module: string;
  exportName: string;
}

function readTemplate(name: string): string {
  return readFileSync(join(PACKAGE_ROOT, name), "utf8");
}

/** `Handler: otel_1_success.handler` -> `{ module, exportName }`. */
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
  return [...template.matchAll(/^\s*-\s*(otel-[a-z-]+-\d+)\s*$/gm)].map(
    (match) => match[1],
  );
}

function handlerSource(module: string): string {
  return readFileSync(join(HANDLERS_ROOT, `${module}.ts`), "utf8");
}

function range(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
}

const template = readTemplate("template.yaml");
const longRunningTemplate = readTemplate("template-long-running.yaml");

describe("template handler references", () => {
  const references = [
    ...handlerReferences(template),
    ...handlerReferences(longRunningTemplate),
  ];
  const handlerModules = readdirSync(HANDLERS_ROOT)
    .filter((file) => /^otel_\d+.*\.ts$/.test(file))
    .map((file) => file.replace(/\.ts$/, ""));

  it("finds a reference in every template function", () => {
    // 44 functions in template.yaml (20 invocation + 20 execution + 4 invoke targets)
    // and 5 in template-long-running.yaml (4 scenarios + 1 invoke target).
    expect(references).toHaveLength(49);
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
  it("covers the invocation and execution suites", () => {
    expect(requirementIds(template).sort()).toEqual(
      [...range("otel-invocation", 20), ...range("otel-execution", 20)].sort(),
    );
  });

  it("covers the long-running suite", () => {
    expect(requirementIds(longRunningTemplate).sort()).toEqual(
      range("otel-long-running", 4).sort(),
    );
  });
});

describe("otel-conformance-tests workflow", () => {
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");

  it("schedules the long-running cycle daily", () => {
    expect(workflow).toContain('  schedule:\n    - cron: "0 7 * * *"');
  });

  it("points examples_dir at this package inside the SDK checkout", () => {
    expect(workflow).toContain(
      `examples_dir: .build/durable-sdk/packages/${PACKAGE_DIR}`,
    );
  });

  it("pins the shared orchestrator to a full commit SHA", () => {
    // A branch name or an unresolved placeholder here fails every run of this workflow with
    // an invalid reusable workflow reference, which is only visible once it is on main.
    const reference = workflow.match(
      /uses: aws\/aws-durable-execution-conformance-tests\/\.github\/workflows\/opentelemetry-orchestrator\.yml@(\S+)/,
    );
    expect(reference?.[1]).toMatch(/^[0-9a-f]{40}$/);
  });

  it("builds this package in the prepare command", () => {
    expect(workflow).toContain(
      `npm run build --workspace packages/${PACKAGE_DIR}`,
    );
  });
});
