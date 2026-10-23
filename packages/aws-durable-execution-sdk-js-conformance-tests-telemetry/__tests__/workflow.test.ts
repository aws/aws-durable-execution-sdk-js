// SPDX-FileCopyrightText: 2026-present Amazon.com, Inc. or its affiliates.
//
// SPDX-License-Identifier: Apache-2.0

// These tests check the caller's paths, build order, and credential boundary.
// They do not require AWS credentials.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_ROOT = join(__dirname, "..");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const WORKFLOW_PATH = ".github/workflows/telemetry-conformance-tests.yml";
const workflow = readFileSync(join(REPO_ROOT, WORKFLOW_PATH), "utf8");

/** A GitHub Actions expression, built so that the source holds no template-like string. */
function expr(body: string): string {
  return "$" + `{{ ${body} }}`;
}

const PACKAGE_DIR =
  "packages/aws-durable-execution-sdk-js-conformance-tests-telemetry";
const SDK_DIR = "packages/aws-durable-execution-sdk-js";
const EXPORTER_DIR = "packages/aws-durable-execution-sdk-js-telemetry-exporter";

/** Text of one top-level key's block, up to the next top-level key. */
function topLevelBlock(key: string): string {
  const match = workflow.match(
    new RegExp(`^${key}:.*\\n(?:(?: .*| *#.*|)\\n)*`, "m"),
  );
  if (!match) throw new Error(`workflow has no top-level ${key} block`);
  return match[0];
}

/** Text of one key under `with:`/`secrets:`, including a `|` block scalar body. */
function inputValue(section: "with" | "secrets", key: string): string {
  const sectionMatch = workflow.match(
    new RegExp(`^ {4}${section}:\\n((?: {6,}.*\\n|\\s*\\n)+)`, "m"),
  );
  if (!sectionMatch) throw new Error(`workflow has no ${section} section`);
  const body = sectionMatch[1];
  const entry = body.match(
    new RegExp(`^ {6}${key}:[ \\t]*(.*)\\n((?: {8,}.*\\n|[ \\t]*\\n)*)`, "m"),
  );
  if (!entry) throw new Error(`${section} has no ${key}`);
  return `${entry[1]}\n${entry[2]}`.trim();
}

function triggerPaths(event: "pull_request" | "push"): string[] {
  const block = topLevelBlock("on");
  const eventMatch = block.match(
    new RegExp(`^ {2}${event}:\\n((?: {4,}.*\\n)+)`, "m"),
  );
  if (!eventMatch) throw new Error(`no ${event} trigger`);
  const paths = eventMatch[1].match(/^ {4}paths:\n((?: {6}- .*\n)+)/m);
  if (!paths) throw new Error(`no paths for ${event}`);
  return [...paths[1].matchAll(/- "(.*)"/g)].map((m) => m[1]);
}

function triggerBranches(event: "pull_request" | "push"): string[] {
  const block = topLevelBlock("on");
  const eventMatch = block.match(
    new RegExp(`^ {2}${event}:\\n((?: {4,}.*\\n)+)`, "m"),
  );
  if (!eventMatch) throw new Error(`no ${event} trigger`);
  const inline = eventMatch[1].match(/^ {4}branches: \[(.*)\]/m);
  if (inline) return inline[1].split(",").map((b) => b.trim());
  const list = eventMatch[1].match(/^ {4}branches:\n((?: {6}- .*\n)+)/m);
  if (!list) throw new Error(`no branches for ${event}`);
  return [...list[1].matchAll(/- (\S+)/g)].map((m) => m[1]);
}

describe("shared workflow call", () => {
  // A full commit SHA keeps workflow updates explicit in SDK pull requests.
  const PINNED_SHA_PATTERN = /^[0-9a-f]{40}$/;

  it("calls the telemetry suite workflow pinned to a full commit SHA", () => {
    const match = workflow.match(
      /^ {4}uses: aws\/aws-durable-execution-conformance-tests\/\.github\/workflows\/telemetry-suite\.yml@(\S+)$/m,
    );
    expect(match).not.toBeNull();
    expect(match?.[1]).toMatch(PINNED_SHA_PATTERN);
  });

  it("passes the JavaScript identity of this SDK", () => {
    expect(inputValue("with", "language")).toBe("js");
    expect(inputValue("with", "resource_prefix")).toBe("js");
    expect(inputValue("with", "sdk_repository")).toBe(
      "aws/aws-durable-execution-sdk-js",
    );
  });

  it("tests the pull request head commit, not the merge commit", () => {
    expect(inputValue("with", "sdk_ref")).toBe(
      expr("github.event.pull_request.head.sha || github.sha"),
    );
  });

  it("builds the handlers from this package", () => {
    const examplesDir = inputValue("with", "examples_dir");
    expect(examplesDir).toBe(`.build/durable-sdk/${PACKAGE_DIR}`);
    expect(existsSync(join(REPO_ROOT, PACKAGE_DIR, "template.yaml"))).toBe(
      true,
    );
  });

  it("defaults the region to us-west-2 and the conformance ref to the shared workflow commit", () => {
    expect(inputValue("with", "aws_region")).toBe(
      expr("inputs.aws_region || 'us-west-2'"),
    );
    // An empty value lets the shared workflow apply its own default (its own SHA).
    expect(inputValue("with", "conformance_test_ref")).toBe(
      expr("inputs.conformance_test_ref"),
    );
  });

  it("passes a runner label and a numeric timeout", () => {
    expect(inputValue("with", "runs_on")).toMatch(
      /^codebuild-github-actions-runner-/,
    );
    expect(inputValue("with", "timeout_minutes")).toBe("30");
  });

  it("maps each repository secret to the shared workflow secret name", () => {
    expect(inputValue("secrets", "CONFORMANCE_TEST_ROLE_ARN")).toBe(
      expr("secrets.TEST_ROLE_ARN"),
    );
    expect(inputValue("secrets", "CONFORMANCE_TEST_ACCOUNT_ID")).toBe(
      expr("secrets.TEST_ACCOUNT_ID"),
    );
    expect(
      inputValue("secrets", "CONFORMANCE_TEST_LAMBDA_EXECUTION_ROLE_ARN"),
    ).toBe(expr("secrets.TEST_LAMBDA_EXECUTION_ROLE_ARN"));
  });
});

describe("setup and prepare commands", () => {
  const setup = inputValue("with", "setup_command");
  const prepare = inputValue("with", "prepare_command");

  it("setup selects Node 22 through the repository scripts", () => {
    expect(setup).toContain(
      '"$SDK_CHECKOUT/.github/workflows/scripts/setup-node22.test.sh"',
    );
    expect(setup).toContain(
      '"$SDK_CHECKOUT/.github/workflows/scripts/setup-node22.sh"',
    );
    expect(
      existsSync(join(REPO_ROOT, ".github/workflows/scripts/setup-node22.sh")),
    ).toBe(true);
    expect(
      existsSync(
        join(REPO_ROOT, ".github/workflows/scripts/setup-node22.test.sh"),
      ),
    ).toBe(true);
  });

  it("prepare runs in the SDK checkout and skips the Electron binary download", () => {
    const lines = prepare.split("\n").map((line) => line.trim());
    const skip = lines.indexOf("export ELECTRON_SKIP_BINARY_DOWNLOAD=1");
    const cd = lines.indexOf('cd "$SDK_CHECKOUT"');
    const install = lines.indexOf("npm ci");
    expect(skip).toBeGreaterThanOrEqual(0);
    expect(cd).toBeGreaterThan(skip);
    expect(install).toBeGreaterThan(cd);
  });

  it("prepare builds the SDK and exporter before testing and building the handlers", () => {
    const commands = prepare
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("npm "));
    expect(commands).toEqual([
      "npm ci",
      `npm run build --workspace ${SDK_DIR}`,
      `npm run build --workspace ${EXPORTER_DIR}`,
      `npm test --workspace ${PACKAGE_DIR}`,
      `npm run build --workspace ${PACKAGE_DIR}`,
    ]);
  });

  it("every workspace the commands name exists", () => {
    for (const dir of [SDK_DIR, EXPORTER_DIR, PACKAGE_DIR]) {
      expect(existsSync(join(REPO_ROOT, dir, "package.json"))).toBe(true);
    }
  });
});

describe("triggers", () => {
  it("runs pull requests against main and the stacked base branch", () => {
    // TEMPORARY entry: remove feat/conformance-tests-telemetry when this pull request is
    // retargeted to main, and update this expectation with it.
    expect(triggerBranches("pull_request")).toEqual([
      "main",
      "feat/conformance-tests-telemetry",
    ]);
  });

  it("runs pushes on main only", () => {
    expect(triggerBranches("push")).toEqual(["main"]);
  });

  it.each(["pull_request", "push"] as const)(
    "%s paths cover everything the run builds or deploys",
    (event) => {
      const paths = triggerPaths(event);
      expect(paths).toEqual(
        expect.arrayContaining([
          `${SDK_DIR}/**`,
          `${EXPORTER_DIR}/**`,
          `${PACKAGE_DIR}/**`,
          "package.json",
          "package-lock.json",
          WORKFLOW_PATH,
          ".github/workflows/scripts/setup-node22*.sh",
        ]),
      );
    },
  );

  it("uses the same paths for pull requests and pushes", () => {
    expect(triggerPaths("pull_request")).toEqual(triggerPaths("push"));
  });

  it("offers manual runs with a region and a conformance ref override", () => {
    const dispatch = topLevelBlock("on").match(
      /^ {2}workflow_dispatch:\n((?: {4,}.*\n)+)/m,
    );
    expect(dispatch).not.toBeNull();
    expect(dispatch?.[1]).toMatch(/^ {6}aws_region:/m);
    expect(dispatch?.[1]).toMatch(/^ {6}conformance_test_ref:/m);
  });
});

describe("job boundaries", () => {
  const job = workflow.slice(workflow.indexOf("\njobs:"));

  it("skips cloud execution for untrusted pull requests", () => {
    const condition = job.match(/^ {4}if: (.*)$/m)?.[1];
    expect(condition).toBe(
      "github.event_name != 'pull_request' || (github.actor != 'dependabot[bot]' && github.event.pull_request.head.repo.full_name == github.repository)",
    );
  });

  it("grants no workflow-level permissions and only contents read and id-token write to the job", () => {
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    const permissions = job.match(/^ {4}permissions:\n((?: {6}.*\n)+)/m)?.[1];
    expect(
      permissions
        ?.trim()
        .split("\n")
        .map((l) => l.trim())
        .sort(),
    ).toEqual(["contents: read", "id-token: write"]);
  });

  it("leaves persistent-stack serialization to the shared workflow", () => {
    // The shared job owns the persistent-stack concurrency group and queues runs.
    expect(workflow).not.toMatch(/^\s*(cancel-in-progress|concurrency):/m);
  });
});
