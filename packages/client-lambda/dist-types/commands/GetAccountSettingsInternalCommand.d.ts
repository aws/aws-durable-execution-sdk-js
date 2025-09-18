import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetAccountSettingsInternalRequest, GetAccountSettingsInternalResponse } from "../models/models_0";
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
 * The input for {@link GetAccountSettingsInternalCommand}.
 */
export interface GetAccountSettingsInternalCommandInput extends GetAccountSettingsInternalRequest {
}
/**
 * @public
 *
 * The output of {@link GetAccountSettingsInternalCommand}.
 */
export interface GetAccountSettingsInternalCommandOutput extends GetAccountSettingsInternalResponse, __MetadataBearer {
}
declare const GetAccountSettingsInternalCommand_base: {
    new (input: GetAccountSettingsInternalCommandInput): import("@smithy/smithy-client").CommandImpl<GetAccountSettingsInternalCommandInput, GetAccountSettingsInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetAccountSettingsInternalCommandInput): import("@smithy/smithy-client").CommandImpl<GetAccountSettingsInternalCommandInput, GetAccountSettingsInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetAccountSettingsInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetAccountSettingsInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetAccountSettingsInternalRequest
 *   AccountId: "STRING_VALUE", // required
 *   FieldsToIncludeInResponse: [ // FieldsList
 *     "STRING_VALUE",
 *   ],
 *   FeaturesToQueryForStatus: [ // FeaturesList
 *     "STRING_VALUE",
 *   ],
 * };
 * const command = new GetAccountSettingsInternalCommand(input);
 * const response = await client.send(command);
 * // { // GetAccountSettingsInternalResponse
 * //   CustomerConfig: { // CustomerConfigInternal
 * //     AccountId: "STRING_VALUE",
 * //     CellId: "STRING_VALUE",
 * //     ControlAPIThrottleLimit: Number("int"),
 * //     DeprecatedFeaturesControlAccess: [ // FeatureList
 * //       "STRING_VALUE",
 * //     ],
 * //     DeprecatedFeaturesInvokeAccess: [
 * //       "STRING_VALUE",
 * //     ],
 * //     Enabled: true || false,
 * //     EniLimit: Number("int"),
 * //     EniVpcLimits: { // EniVpc
 * //       "<keys>": Number("int"),
 * //     },
 * //     EventSourceMappingRestrictions: [ // MappingRestrictions
 * //       "STRING_VALUE",
 * //     ],
 * //     GetFunctionAPIThrottleLimit: Number("int"),
 * //     GetPolicyAPIThrottleLimit: Number("int"),
 * //     InvokeAsyncThrottleLimit: Number("int"),
 * //     LargeCloudFunctionConcurrencyLimit: Number("int"),
 * //     MaxQueueDepth: Number("int"),
 * //     PreviewFeatures: [
 * //       "STRING_VALUE",
 * //     ],
 * //     DenyListFeatures: [
 * //       "STRING_VALUE",
 * //     ],
 * //     RequestSignerInvokeTpsLimitOverride: Number("int"),
 * //     RuntimesPinnedToAL1703ByDefaultOnCreate: [ // AL1703Runtimes
 * //       "STRING_VALUE",
 * //     ],
 * //     RuntimesPinnedToAL1703ByDefaultOnUpdate: [
 * //       "STRING_VALUE",
 * //     ],
 * //     SmallCloudFunctionConcurrencyLimit: Number("int"),
 * //     SqsQueueName: "STRING_VALUE",
 * //     UnreservedConcurrentExecutions: Number("int"),
 * //     UnreservedConcurrentExecutionsMinimum: Number("int"),
 * //     VersionString: "STRING_VALUE", // required
 * //     MigrationStatus: "STRING_VALUE",
 * //     AliasLimit: Number("long"),
 * //     ArcScalingParameters: { // Map
 * //       "<keys>": "STRING_VALUE",
 * //     },
 * //     TotalCodeSizeLimit: Number("long"),
 * //     AccountStatus: "STRING_VALUE",
 * //     AccountStatusTimestampAsEpochMilli: Number("long"),
 * //     AccountStatusEvent: "STRING_VALUE",
 * //     ConcurrencySequenceNumber: Number("long"),
 * //     CountingServiceBatchDivisor: Number("int"),
 * //     CountingServiceBatchParameters: { // MapStringToInteger
 * //       "<keys>": Number("int"),
 * //     },
 * //     SplitCountParameters: { // MapStringToLong
 * //       "<keys>": Number("long"),
 * //     },
 * //     ProvisionedConcurrencyPreWarmingRate: Number("int"),
 * //     FunctionMemorySizeLimit: Number("int"),
 * //     AccountRiskMetadata: {
 * //       "<keys>": Number("int"),
 * //     },
 * //     AccountRiskStatusTimestamp: new Date("TIMESTAMP"),
 * //     AccountRiskSource: "STRING_VALUE",
 * //     ShardPoolParameters: {
 * //       "<keys>": Number("long"),
 * //     },
 * //     Features: [ // Features
 * //       { // FeaturesListItem
 * //         FeatureName: "STRING_VALUE",
 * //         FeatureStatus: "Accessible" || "Inaccessible",
 * //       },
 * //     ],
 * //   },
 * // };
 *
 * ```
 *
 * @param GetAccountSettingsInternalCommandInput - {@link GetAccountSettingsInternalCommandInput}
 * @returns {@link GetAccountSettingsInternalCommandOutput}
 * @see {@link GetAccountSettingsInternalCommandInput} for command's `input` shape.
 * @see {@link GetAccountSettingsInternalCommandOutput} for command's `response` shape.
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
export declare class GetAccountSettingsInternalCommand extends GetAccountSettingsInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetAccountSettingsInternalRequest;
            output: GetAccountSettingsInternalResponse;
        };
        sdk: {
            input: GetAccountSettingsInternalCommandInput;
            output: GetAccountSettingsInternalCommandOutput;
        };
    };
}
