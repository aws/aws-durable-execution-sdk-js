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
}

export type ExamplesWithConfig = ExampleConfig & {
  path: string;
  handler: string;
};
