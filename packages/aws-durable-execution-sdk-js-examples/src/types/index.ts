import { DurableConfig } from "@aws-sdk/client-lambda";

export interface ExampleConfig {
  name: string;
  description?: string;
  /**
   * The durable config of the function. By default, RetentionPeriodInDays will be set to 7 days
   * and ExecutionTimeout will be set to 60 seconds. Null if function is not durable.
   */
  durableConfig?: DurableConfig | null;
}

export type ExamplesWithConfig = ExampleConfig & {
  path: string;
  handler: string;
};
