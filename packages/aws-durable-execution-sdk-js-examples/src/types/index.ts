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
