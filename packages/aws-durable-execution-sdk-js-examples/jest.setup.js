// Jest setup file: isolate the suite from a Lambda-shaped host environment.
//
// When the tests themselves run inside Lambda (for example on CodeBuild Lambda
// compute acting as a GitHub Actions runner), the runtime injects an X-Ray
// header with Sampled=0 and the AWS_LAMBDA_* variables. The OTel
// xRayContextExtractor and the Powertools Logger read these from the process
// environment, so spans become non-recording and every log line grows an
// xray_trace_id field. Tests that need one of these values set it explicitly.
const LAMBDA_ENV_KEYS = [
  "_X_AMZN_TRACE_ID",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_LAMBDA_FUNCTION_VERSION",
  "AWS_LAMBDA_FUNCTION_MEMORY_SIZE",
];

const saved = Object.fromEntries(LAMBDA_ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  for (const key of LAMBDA_ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
