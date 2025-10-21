import { DurableConfig } from "@aws-sdk/client-lambda";

export interface ExampleConfig {
  name: string;
  description?: string;
  /**
   * The durable config of the function. By default, RetentionPeriodInDays will be set to 7 days
   * and ExecutionTimeout will be set to 60 seconds.
   */
  durableConfig?: DurableConfig;
}

export type ExamplesWithConfig = ExampleConfig & {
  durableConfig: DurableConfig;
  path: string;
  handler: string;
};
