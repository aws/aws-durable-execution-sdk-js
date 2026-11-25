import {
  DurableConfig,
  LambdaManagedInstancesCapacityProviderConfig,
} from "@aws-sdk/client-lambda";

export interface ExampleConfig {
  name: string;
  description?: string;
  /**
   * The durable config of the function. By default, RetentionPeriodInDays will be set to 7 days
   * and ExecutionTimeout will be set to 60 seconds. Null if function is not durable.
   */
  durableConfig?: DurableConfig | null;
  /**
   * Optional override for the Lambda function's per-invocation `Timeout` (in seconds).
   * This is the maximum time a single Lambda invocation can run before the platform
   * kills it — distinct from `durableConfig.ExecutionTimeout`, which is the total
   * time the durable execution can run across multiple invocations.
   *
   * Defaults to 60 seconds. Set this to a small value when the example needs to
   * deliberately exceed the per-invocation timeout (e.g. step interruption tests).
   */
  lambdaTimeoutSeconds?: number;
  /**
   * If provided, this example will be deployed both as a regular function and as a function on
   * a managed instance. The tests will be ran against both deployed functions.
   */
  capacityProviderConfig?: Omit<
    LambdaManagedInstancesCapacityProviderConfig,
    "CapacityProviderArn"
  >;
  /**
   * If true, this example is only run locally and is excluded from cloud deployment
   * and integration tests. The example remains in the catalog for bundling purposes.
   */
  localOnly?: boolean;
  /**
   * Examples (paths under src/examples) whose tests already cover this one.
   * Set it on an example kept as a customer sample that has no test of its own.
   * Such an example is left out of the integration deployment, since nothing
   * would invoke it, but stays in the published SAM template.
   */
  testedBy?: string[];
  /**
   * If provided, this example will be excluded from cloud deployment and integration
   * tests for the specified runtimes. Use Node.js runtime version strings like "24.x".
   * The example will still run locally and on other runtimes not listed here.
   */
  excludeRuntimes?: string[];
  /**
   * If true, the example runs a job in a Lambda MicroVM. The integration test
   * builds the MicroVM image and sets `MICROVM_IMAGE_ARN` and
   * `MICROVM_EXECUTION_ROLE_ARN` on the function. A SAM template generated
   * without an image leaves the example out.
   */
  usesMicrovm?: boolean;
  /**
   * If true, the integration tests deploy this example in its own Lambda
   * function. Otherwise the examples of one folder share a function, and the
   * examples that are alone in their folder share a "misc" function.
   * Set it when one of these is true:
   * - Another example invokes this one by function name.
   * - The test does not use `createTests`, for example because it builds its
   *   own `CloudDurableTestRunner`.
   * - The function settings differ from the rest of the group, such as
   *   `durableConfig` or `lambdaTimeoutSeconds`. The deploy fails with
   *   "needs other function settings" in that case.
   * - The input is too large for the invocation event, as in large-payload.
   */
  ownFunction?: boolean;
}

export type ExamplesWithConfig = ExampleConfig & {
  path: string;
  handler: string;
};
