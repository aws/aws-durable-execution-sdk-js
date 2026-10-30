// Reads the standard OpenTelemetry environment variables that apply to this plugin
// (README "Environment variables"). A value in the plugin's config wins over the
// environment. The environment wins over the defaults.
//
// An invalid value is ignored, and one line is logged. A configuration mistake must not
// fail the workflow, and it must not pass unnoticed.

const warn = (message) => {
  // biome-ignore lint/suspicious/noConsole: deliberate -- an ignored setting must be visible, and Lambda sends console output to CloudWatch.
  console.warn(`durable-execution-sdk-js-lite-otel: ${message}`);
};

// OTEL_SDK_DISABLED is true only for the value "true", in any case. Every other value is
// false, as the OpenTelemetry specification defines for boolean variables.
export const isDisabled = (env) =>
  env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true";

// OTEL_RESOURCE_ATTRIBUTES has the form key1=value1,key2=value2. Keys and values are
// percent-encoded. Returns the attributes, or {} when the variable is unset or empty.
// One invalid pair makes the whole value invalid, as the specification requires. Then
// the result is {}, and one line is logged.
export function resourceAttributes(env) {
  const raw = env.OTEL_RESOURCE_ATTRIBUTES?.trim();
  if (!raw) return {};
  const attributes = {};
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? "" : decode(pair.slice(0, eq).trim());
    const value = eq < 0 ? undefined : decode(pair.slice(eq + 1).trim());
    if (!key || value === undefined) {
      warn(
        `OTEL_RESOURCE_ATTRIBUTES ignored: "${pair.trim()}" is not a key=value pair with percent-encoding`,
      );
      return {};
    }
    attributes[key] = value;
  }
  return attributes;
}

// Returns undefined for an invalid percent-encoding, for example "%zz".
function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

// The samplers of OTEL_TRACES_SAMPLER that the plugin supports. ratio undefined means
// that the ratio comes from OTEL_TRACES_SAMPLER_ARG.
const SAMPLERS = {
  always_on: { parentBased: false, ratio: 1 },
  always_off: { parentBased: false, ratio: 0 },
  traceidratio: { parentBased: false, ratio: undefined },
  parentbased_always_on: { parentBased: true, ratio: 1 },
  parentbased_always_off: { parentBased: true, ratio: 0 },
  parentbased_traceidratio: { parentBased: true, ratio: undefined },
};

// Returns { parentBased, ratio } from OTEL_TRACES_SAMPLER and OTEL_TRACES_SAMPLER_ARG, or
// undefined when OTEL_TRACES_SAMPLER is unset or not supported:
// 1. The names are case-insensitive, as the specification defines for enum values.
// 2. Another sampler, for example xray or jaeger_remote, needs a sampler object that this
//    plugin does not have. So it is ignored, and one line is logged.
// 3. The ratio of a *traceidratio sampler is OTEL_TRACES_SAMPLER_ARG. It defaults to 1,
//    as in the specification. A value that is not a number from 0 to 1 is replaced by 1,
//    and one line is logged.
export function sampler(env) {
  const name = env.OTEL_TRACES_SAMPLER?.trim().toLowerCase();
  if (!name) return undefined;
  const known = SAMPLERS[name];
  if (known === undefined) {
    warn(
      `OTEL_TRACES_SAMPLER "${name}" is not supported and ignored. Supported: ${Object.keys(SAMPLERS).join(", ")}`,
    );
    return undefined;
  }
  if (known.ratio !== undefined) return known;
  return { parentBased: known.parentBased, ratio: samplerArg(env) };
}

function samplerArg(env) {
  const raw = env.OTEL_TRACES_SAMPLER_ARG?.trim();
  if (!raw) return 1;
  const ratio = Number(raw);
  if (Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) return ratio;
  warn(
    `OTEL_TRACES_SAMPLER_ARG "${raw}" is not a number from 0 to 1. The ratio is 1`,
  );
  return 1;
}
