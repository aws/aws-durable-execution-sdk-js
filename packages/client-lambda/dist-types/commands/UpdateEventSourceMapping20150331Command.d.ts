import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { EventSourceMappingConfiguration } from "../models/models_0";
import { UpdateEventSourceMappingRequest } from "../models/models_1";
import { Command as $Command } from "@smithy/smithy-client";
import { MetadataBearer as __MetadataBearer } from "@smithy/types";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 *
 * The input for {@link UpdateEventSourceMapping20150331Command}.
 */
export interface UpdateEventSourceMapping20150331CommandInput extends UpdateEventSourceMappingRequest {
}
/**
 * @public
 *
 * The output of {@link UpdateEventSourceMapping20150331Command}.
 */
export interface UpdateEventSourceMapping20150331CommandOutput extends EventSourceMappingConfiguration, __MetadataBearer {
}
declare const UpdateEventSourceMapping20150331Command_base: {
    new (input: UpdateEventSourceMapping20150331CommandInput): import("@smithy/smithy-client").CommandImpl<UpdateEventSourceMapping20150331CommandInput, UpdateEventSourceMapping20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: UpdateEventSourceMapping20150331CommandInput): import("@smithy/smithy-client").CommandImpl<UpdateEventSourceMapping20150331CommandInput, UpdateEventSourceMapping20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, UpdateEventSourceMapping20150331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, UpdateEventSourceMapping20150331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // UpdateEventSourceMappingRequest
 *   UUID: "STRING_VALUE", // required
 *   FunctionName: "STRING_VALUE",
 *   Enabled: true || false,
 *   BatchSize: Number("int"),
 *   FilterCriteria: { // FilterCriteria
 *     Filters: [ // FilterList
 *       { // Filter
 *         Pattern: "STRING_VALUE",
 *       },
 *     ],
 *   },
 *   KMSKeyArn: "STRING_VALUE",
 *   MetricsConfig: { // EventSourceMappingMetricsConfig
 *     Metrics: [ // EventSourceMappingMetricList
 *       "EventCount",
 *     ],
 *   },
 *   ScalingConfig: { // ScalingConfig
 *     MaximumConcurrency: Number("int"),
 *   },
 *   MaximumBatchingWindowInSeconds: Number("int"),
 *   ParallelizationFactor: Number("int"),
 *   DestinationConfig: { // DestinationConfig
 *     OnSuccess: { // OnSuccess
 *       Destination: "STRING_VALUE",
 *     },
 *     OnFailure: { // OnFailure
 *       Destination: "STRING_VALUE",
 *     },
 *   },
 *   MaximumRecordAgeInSeconds: Number("int"),
 *   BisectBatchOnFunctionError: true || false,
 *   MaximumRetryAttempts: Number("int"),
 *   PartialBatchResponse: true || false,
 *   TumblingWindowInSeconds: Number("int"),
 *   SourceAccessConfigurations: [ // SourceAccessConfigurations
 *     { // SourceAccessConfiguration
 *       Type: "BASIC_AUTH" || "VPC_SUBNET" || "VPC_SECURITY_GROUP" || "SASL_SCRAM_512_AUTH" || "SASL_SCRAM_256_AUTH" || "VIRTUAL_HOST" || "CLIENT_CERTIFICATE_TLS_AUTH" || "SERVER_ROOT_CA_CERTIFICATE",
 *       URI: "STRING_VALUE",
 *     },
 *   ],
 *   FunctionResponseTypes: [ // FunctionResponseTypeList
 *     "ReportBatchItemFailures",
 *   ],
 *   AmazonManagedKafkaEventSourceConfig: { // AmazonManagedKafkaEventSourceConfig
 *     ConsumerGroupId: "STRING_VALUE",
 *     SchemaRegistryConfig: { // KafkaSchemaRegistryConfig
 *       SchemaRegistryURI: "STRING_VALUE",
 *       EventRecordFormat: "JSON" || "SOURCE",
 *       AccessConfigs: [ // KafkaSchemaRegistryAccessConfigList
 *         { // KafkaSchemaRegistryAccessConfig
 *           Type: "BASIC_AUTH" || "CLIENT_CERTIFICATE_TLS_AUTH" || "SERVER_ROOT_CA_CERTIFICATE",
 *           URI: "STRING_VALUE",
 *         },
 *       ],
 *       SchemaValidationConfigs: [ // KafkaSchemaValidationConfigList
 *         { // KafkaSchemaValidationConfig
 *           Attribute: "KEY" || "VALUE",
 *         },
 *       ],
 *     },
 *   },
 *   SelfManagedKafkaEventSourceConfig: { // SelfManagedKafkaEventSourceConfig
 *     ConsumerGroupId: "STRING_VALUE",
 *     SchemaRegistryConfig: {
 *       SchemaRegistryURI: "STRING_VALUE",
 *       EventRecordFormat: "JSON" || "SOURCE",
 *       AccessConfigs: [
 *         {
 *           Type: "BASIC_AUTH" || "CLIENT_CERTIFICATE_TLS_AUTH" || "SERVER_ROOT_CA_CERTIFICATE",
 *           URI: "STRING_VALUE",
 *         },
 *       ],
 *       SchemaValidationConfigs: [
 *         {
 *           Attribute: "KEY" || "VALUE",
 *         },
 *       ],
 *     },
 *   },
 *   DocumentDBEventSourceConfig: { // DocumentDBEventSourceConfig
 *     DatabaseName: "STRING_VALUE",
 *     CollectionName: "STRING_VALUE",
 *     FullDocument: "UpdateLookup" || "Default",
 *   },
 *   ProvisionedPollerConfig: { // ProvisionedPollerConfig
 *     MinimumPollers: Number("int"),
 *     MaximumPollers: Number("int"),
 *   },
 * };
 * const command = new UpdateEventSourceMapping20150331Command(input);
 * const response = await client.send(command);
 * // { // EventSourceMappingConfiguration
 * //   UUID: "STRING_VALUE",
 * //   StartingPosition: "TRIM_HORIZON" || "LATEST" || "AT_TIMESTAMP",
 * //   StartingPositionTimestamp: new Date("TIMESTAMP"),
 * //   BatchSize: Number("int"),
 * //   MaximumBatchingWindowInSeconds: Number("int"),
 * //   ParallelizationFactor: Number("int"),
 * //   EventSourceArn: "STRING_VALUE",
 * //   FilterCriteria: { // FilterCriteria
 * //     Filters: [ // FilterList
 * //       { // Filter
 * //         Pattern: "STRING_VALUE",
 * //       },
 * //     ],
 * //   },
 * //   FilterCriteriaError: { // FilterCriteriaError
 * //     ErrorCode: "STRING_VALUE",
 * //     Message: "STRING_VALUE",
 * //   },
 * //   KMSKeyArn: "STRING_VALUE",
 * //   MetricsConfig: { // EventSourceMappingMetricsConfig
 * //     Metrics: [ // EventSourceMappingMetricList
 * //       "EventCount",
 * //     ],
 * //   },
 * //   ScalingConfig: { // ScalingConfig
 * //     MaximumConcurrency: Number("int"),
 * //   },
 * //   FunctionArn: "STRING_VALUE",
 * //   LastModified: new Date("TIMESTAMP"),
 * //   LastProcessingResult: "STRING_VALUE",
 * //   State: "STRING_VALUE",
 * //   StateTransitionReason: "STRING_VALUE",
 * //   DestinationConfig: { // DestinationConfig
 * //     OnSuccess: { // OnSuccess
 * //       Destination: "STRING_VALUE",
 * //     },
 * //     OnFailure: { // OnFailure
 * //       Destination: "STRING_VALUE",
 * //     },
 * //   },
 * //   Topics: [ // Topics
 * //     "STRING_VALUE",
 * //   ],
 * //   Queues: [ // Queues
 * //     "STRING_VALUE",
 * //   ],
 * //   SourceAccessConfigurations: [ // SourceAccessConfigurations
 * //     { // SourceAccessConfiguration
 * //       Type: "BASIC_AUTH" || "VPC_SUBNET" || "VPC_SECURITY_GROUP" || "SASL_SCRAM_512_AUTH" || "SASL_SCRAM_256_AUTH" || "VIRTUAL_HOST" || "CLIENT_CERTIFICATE_TLS_AUTH" || "SERVER_ROOT_CA_CERTIFICATE",
 * //       URI: "STRING_VALUE",
 * //     },
 * //   ],
 * //   SelfManagedEventSource: { // SelfManagedEventSource
 * //     Endpoints: { // Endpoints
 * //       "<keys>": [ // EndpointLists
 * //         "STRING_VALUE",
 * //       ],
 * //     },
 * //   },
 * //   MaximumRecordAgeInSeconds: Number("int"),
 * //   BisectBatchOnFunctionError: true || false,
 * //   MaximumRetryAttempts: Number("int"),
 * //   PartialBatchResponse: true || false,
 * //   TumblingWindowInSeconds: Number("int"),
 * //   FunctionResponseTypes: [ // FunctionResponseTypeList
 * //     "ReportBatchItemFailures",
 * //   ],
 * //   AmazonManagedKafkaEventSourceConfig: { // AmazonManagedKafkaEventSourceConfig
 * //     ConsumerGroupId: "STRING_VALUE",
 * //     SchemaRegistryConfig: { // KafkaSchemaRegistryConfig
 * //       SchemaRegistryURI: "STRING_VALUE",
 * //       EventRecordFormat: "JSON" || "SOURCE",
 * //       AccessConfigs: [ // KafkaSchemaRegistryAccessConfigList
 * //         { // KafkaSchemaRegistryAccessConfig
 * //           Type: "BASIC_AUTH" || "CLIENT_CERTIFICATE_TLS_AUTH" || "SERVER_ROOT_CA_CERTIFICATE",
 * //           URI: "STRING_VALUE",
 * //         },
 * //       ],
 * //       SchemaValidationConfigs: [ // KafkaSchemaValidationConfigList
 * //         { // KafkaSchemaValidationConfig
 * //           Attribute: "KEY" || "VALUE",
 * //         },
 * //       ],
 * //     },
 * //   },
 * //   SelfManagedKafkaEventSourceConfig: { // SelfManagedKafkaEventSourceConfig
 * //     ConsumerGroupId: "STRING_VALUE",
 * //     SchemaRegistryConfig: {
 * //       SchemaRegistryURI: "STRING_VALUE",
 * //       EventRecordFormat: "JSON" || "SOURCE",
 * //       AccessConfigs: [
 * //         {
 * //           Type: "BASIC_AUTH" || "CLIENT_CERTIFICATE_TLS_AUTH" || "SERVER_ROOT_CA_CERTIFICATE",
 * //           URI: "STRING_VALUE",
 * //         },
 * //       ],
 * //       SchemaValidationConfigs: [
 * //         {
 * //           Attribute: "KEY" || "VALUE",
 * //         },
 * //       ],
 * //     },
 * //   },
 * //   DocumentDBEventSourceConfig: { // DocumentDBEventSourceConfig
 * //     DatabaseName: "STRING_VALUE",
 * //     CollectionName: "STRING_VALUE",
 * //     FullDocument: "UpdateLookup" || "Default",
 * //   },
 * //   EventSourceMappingArn: "STRING_VALUE",
 * //   ProvisionedPollerConfig: { // ProvisionedPollerConfig
 * //     MinimumPollers: Number("int"),
 * //     MaximumPollers: Number("int"),
 * //   },
 * // };
 *
 * ```
 *
 * @param UpdateEventSourceMapping20150331CommandInput - {@link UpdateEventSourceMapping20150331CommandInput}
 * @returns {@link UpdateEventSourceMapping20150331CommandOutput}
 * @see {@link UpdateEventSourceMapping20150331CommandInput} for command's `input` shape.
 * @see {@link UpdateEventSourceMapping20150331CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
 *
 * @throws {@link ResourceInUseException} (client fault)
 *
 * @throws {@link ResourceNotFoundException} (client fault)
 *
 * @throws {@link ServiceException} (server fault)
 *
 * @throws {@link TooManyRequestsException} (client fault)
 *
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class UpdateEventSourceMapping20150331Command extends UpdateEventSourceMapping20150331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: UpdateEventSourceMappingRequest;
            output: EventSourceMappingConfiguration;
        };
        sdk: {
            input: UpdateEventSourceMapping20150331CommandInput;
            output: UpdateEventSourceMapping20150331CommandOutput;
        };
    };
}
