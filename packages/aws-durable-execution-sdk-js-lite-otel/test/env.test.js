import assert from "node:assert/strict";
import { test } from "node:test";
import { createOtelPlugin } from "../src/index.js";
import { fakeExporter, info } from "./helpers.js";

const VARS = [
  "OTEL_SDK_DISABLED",
  "OTEL_SERVICE_NAME",
  "OTEL_RESOURCE_ATTRIBUTES",
  "OTEL_TRACES_SAMPLER",
  "OTEL_TRACES_SAMPLER_ARG",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_REGION",
  "_X_AMZN_TRACE_ID",
];

// Sets the variables for one test, removes the other ones of VARS, and records every
// console.warn line. Restores everything after the test.
function withEnv(t, values) {
  const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  Object.assign(process.env, values);
  const warnings = [];
  t.mock.method(console, "warn", (line) => warnings.push(line));
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  return warnings;
}

const end = {
  status: "PENDING",
  result: undefined,
  error: undefined,
  operations: [{ Id: "exec", Type: "EXECUTION", Status: "STARTED" }],
};

async function resourceOf(config = {}) {
  const exporter = fakeExporter();
  await createOtelPlugin({ exporter, ...config })(info()).onInvocationEnd(end);
  return exporter.spans()[0].resource.attributes;
}

// A trace id whose sampling ratio is about 0.5: the last 8 hex digits are 0x80000000.
const MID = `${"a".repeat(24)}80000000`;
const header = (sampled, root = MID) =>
  `Root=1-${root.slice(0, 8)}-${root.slice(8)};Parent=89abcdef01234567${sampled === undefined ? "" : `;Sampled=${sampled}`};Lineage=1:d106aac2:0`;
const traced = (config, sampled, root) =>
  createOtelPlugin({ exporter: fakeExporter(), ...config })(
    info({ lambdaContext: { xRayTraceId: header(sampled, root) } }),
  ) !== undefined;

test("OTEL_SDK_DISABLED=true gives no plugin; other values change nothing", (t) => {
  withEnv(t, { OTEL_SDK_DISABLED: "TRUE" });
  assert.equal(
    createOtelPlugin({ exporter: fakeExporter() })(info()),
    undefined,
  );
  for (const value of ["false", "1", "yes", ""]) {
    process.env.OTEL_SDK_DISABLED = value;
    assert.notEqual(
      createOtelPlugin({ exporter: fakeExporter() })(info()),
      undefined,
      value,
    );
  }
});

test("service.name: serviceName, then OTEL_SERVICE_NAME, then OTEL_RESOURCE_ATTRIBUTES, then the function name", async (t) => {
  withEnv(t, {
    AWS_LAMBDA_FUNCTION_NAME: "fn",
    OTEL_RESOURCE_ATTRIBUTES: "service.name=from-attrs",
    OTEL_SERVICE_NAME: "from-env",
  });
  assert.equal(
    (await resourceOf({ serviceName: "code" }))["service.name"],
    "code",
  );
  assert.equal((await resourceOf())["service.name"], "from-env");
  delete process.env.OTEL_SERVICE_NAME;
  assert.equal((await resourceOf())["service.name"], "from-attrs");
  delete process.env.OTEL_RESOURCE_ATTRIBUTES;
  assert.equal((await resourceOf())["service.name"], "fn");
});

test("OTEL_RESOURCE_ATTRIBUTES is percent-decoded and replaces defaults of the same name", async (t) => {
  withEnv(t, {
    AWS_REGION: "us-west-2",
    OTEL_RESOURCE_ATTRIBUTES:
      " deployment.environment.name = prod , team=a%2Cb%3Dc , cloud.region=eu-west-1",
  });
  assert.deepEqual(await resourceOf(), {
    "service.name": "durable-function",
    "cloud.provider": "aws",
    "cloud.region": "eu-west-1",
    "deployment.environment.name": "prod",
    team: "a,b=c",
  });
});

test("an invalid OTEL_RESOURCE_ATTRIBUTES is ignored as a whole, with one warning", async (t) => {
  const warnings = withEnv(t, {});
  for (const value of ["a=1,b", "a=1,=2", "a=%zz"]) {
    warnings.length = 0;
    process.env.OTEL_RESOURCE_ATTRIBUTES = value;
    const attrs = await resourceOf();
    assert.equal(attrs.a, undefined, value);
    assert.equal(warnings.length, 1, value);
    assert.match(warnings[0], /OTEL_RESOURCE_ATTRIBUTES ignored/);
  }
});

test("a given resource is used as is; the environment does not change it", async (t) => {
  withEnv(t, {
    OTEL_SERVICE_NAME: "from-env",
    OTEL_RESOURCE_ATTRIBUTES: "a=1",
  });
  const resource = { attributes: { "service.name": "mine" } };
  const exporter = fakeExporter();
  await createOtelPlugin({ exporter, resource })(info()).onInvocationEnd(end);
  assert.equal(exporter.spans()[0].resource, resource);
  assert.deepEqual(resource.attributes, { "service.name": "mine" });
});

test("OTEL_TRACES_SAMPLER sets the ratio and parent-based sampling", (t) => {
  withEnv(t, {});
  const cases = [
    // [sampler, arg, Sampled, traced]
    ["always_off", undefined, "1", false],
    ["ALWAYS_ON", undefined, "0", true],
    ["traceidratio", "0.6", "0", true],
    ["traceidratio", "0.4", "1", false],
    ["traceidratio", undefined, "0", true],
    ["parentbased_always_on", undefined, "0", false],
    ["parentbased_always_on", undefined, "1", true],
    ["parentbased_always_on", undefined, undefined, true],
    ["parentbased_always_off", undefined, "1", true],
    ["parentbased_always_off", undefined, undefined, false],
    ["parentbased_traceidratio", "0.4", "1", true],
    ["parentbased_traceidratio", "0.4", undefined, false],
    ["parentbased_traceidratio", "0.6", undefined, true],
  ];
  for (const [name, arg, sampled, expected] of cases) {
    process.env.OTEL_TRACES_SAMPLER = name;
    if (arg === undefined) delete process.env.OTEL_TRACES_SAMPLER_ARG;
    else process.env.OTEL_TRACES_SAMPLER_ARG = arg;
    assert.equal(traced({}, sampled), expected, `${name} ${arg} ${sampled}`);
  }
});

test("Sampled=? is no decision, so the ratio decides", (t) => {
  withEnv(t, { OTEL_TRACES_SAMPLER: "parentbased_always_off" });
  assert.equal(traced({}, "?"), false);
  assert.equal(traced({ sampleRate: 1 }, "?"), true);
});

test("config wins over OTEL_TRACES_SAMPLER, field by field", (t) => {
  withEnv(t, {
    OTEL_TRACES_SAMPLER: "parentbased_traceidratio",
    OTEL_TRACES_SAMPLER_ARG: "0.4",
  });
  // sampleRate replaces the ratio. The env still makes it parent-based.
  assert.equal(traced({ sampleRate: 1 }, "0"), false);
  assert.equal(traced({ sampleRate: 1 }, undefined), true);
  // parentBased false: Sampled is ignored, the env's ratio 0.4 decides.
  assert.equal(traced({ parentBased: false }, "1"), false);
  assert.equal(traced({ parentBased: false, sampleRate: 0.6 }, "0"), true);
});

test("without config and env, Sampled is ignored and every execution is traced", (t) => {
  withEnv(t, {});
  assert.equal(traced({}, "0"), true);
  assert.equal(traced({ parentBased: true }, "0"), false);
  assert.equal(traced({ parentBased: true }, "1"), true);
});

test("an unsupported sampler or an invalid ratio is replaced by the default, with one warning", (t) => {
  const warnings = withEnv(t, { OTEL_TRACES_SAMPLER: "xray" });
  assert.equal(traced({}, "0"), true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /OTEL_TRACES_SAMPLER "xray" is not supported/);

  for (const arg of ["2", "-0.1", "half"]) {
    warnings.length = 0;
    process.env.OTEL_TRACES_SAMPLER = "traceidratio";
    process.env.OTEL_TRACES_SAMPLER_ARG = arg;
    assert.equal(traced({}, "0"), true, arg);
    assert.equal(warnings.length, 1, arg);
    assert.match(warnings[0], /OTEL_TRACES_SAMPLER_ARG/);
  }
});

test("a parent-based caller passes Sampled=1 to the invoked execution", (t) => {
  withEnv(t, { OTEL_TRACES_SAMPLER: "parentbased_always_off" });
  const caller = createOtelPlugin({ exporter: fakeExporter() })(
    info({ lambdaContext: { xRayTraceId: header("1") } }),
  );
  const sent = caller.traceHeader({ id: "op-1" });
  const callee = createOtelPlugin({ exporter: fakeExporter() })(
    info({ lambdaContext: { xRayTraceId: sent } }),
  );
  assert.notEqual(callee, undefined);
});
