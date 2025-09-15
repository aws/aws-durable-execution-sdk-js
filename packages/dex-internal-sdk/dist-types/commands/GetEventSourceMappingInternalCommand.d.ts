import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { EventSourceMappingConfiguration, GetEventSourceMappingInternalRequest } from "../models/models_0";
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
 * The input for {@link GetEventSourceMappingInternalCommand}.
 */
export interface GetEventSourceMappingInternalCommandInput extends GetEventSourceMappingInternalRequest {
}
/**
 * @public
 *
 * The output of {@link GetEventSourceMappingInternalCommand}.
 */
export interface GetEventSourceMappingInternalCommandOutput extends EventSourceMappingConfiguration, __MetadataBearer {
}
declare const GetEventSourceMappingInternalCommand_base: {
    new (input: GetEventSourceMappingInternalCommandInput): import("@smithy/smithy-client").CommandImpl<GetEventSourceMappingInternalCommandInput, GetEventSourceMappingInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetEventSourceMappingInternalCommandInput): import("@smithy/smithy-client").CommandImpl<GetEventSourceMappingInternalCommandInput, GetEventSourceMappingInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetEventSourceMappingInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetEventSourceMappingInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetEventSourceMappingInternalRequest
 *   UUID: "STRING_VALUE", // required
 * };
 * const command = new GetEventSourceMappingInternalCommand(input);
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
 * @param GetEventSourceMappingInternalCommandInput - {@link GetEventSourceMappingInternalCommandInput}
 * @returns {@link GetEventSourceMappingInternalCommandOutput}
 * @see {@link GetEventSourceMappingInternalCommandInput} for command's `input` shape.
 * @see {@link GetEventSourceMappingInternalCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
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
export declare class GetEventSourceMappingInternalCommand extends GetEventSourceMappingInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetEventSourceMappingInternalRequest;
            output: EventSourceMappingConfiguration;
        };
        sdk: {
            input: GetEventSourceMappingInternalCommandInput;
            output: GetEventSourceMappingInternalCommandOutput;
        };
    };
}
