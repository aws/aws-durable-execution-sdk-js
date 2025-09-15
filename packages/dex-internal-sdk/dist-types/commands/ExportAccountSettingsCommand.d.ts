import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ExportAccountSettingsRequest, ExportAccountSettingsResponse } from "../models/models_0";
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
 * The input for {@link ExportAccountSettingsCommand}.
 */
export interface ExportAccountSettingsCommandInput extends ExportAccountSettingsRequest {
}
/**
 * @public
 *
 * The output of {@link ExportAccountSettingsCommand}.
 */
export interface ExportAccountSettingsCommandOutput extends ExportAccountSettingsResponse, __MetadataBearer {
}
declare const ExportAccountSettingsCommand_base: {
    new (input: ExportAccountSettingsCommandInput): import("@smithy/smithy-client").CommandImpl<ExportAccountSettingsCommandInput, ExportAccountSettingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ExportAccountSettingsCommandInput): import("@smithy/smithy-client").CommandImpl<ExportAccountSettingsCommandInput, ExportAccountSettingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ExportAccountSettingsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ExportAccountSettingsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ExportAccountSettingsRequest
 *   AccountId: "STRING_VALUE", // required
 * };
 * const command = new ExportAccountSettingsCommand(input);
 * const response = await client.send(command);
 * // { // ExportAccountSettingsResponse
 * //   CodeStorageTableEntry: { // CodeStorageTableEntry
 * //     AliasCount: Number("long"),
 * //     FunctionCount: Number("long"),
 * //     CodeSizeBytes: Number("long"),
 * //   },
 * //   RiskSettings: { // MigrationAccountRiskSettings
 * //     RiskDetectedTime: new Date("TIMESTAMP"),
 * //     RiskSource: "STRING_VALUE",
 * //     AccountRiskMetadata: { // MapStringToInteger
 * //       "<keys>": Number("int"),
 * //     },
 * //   },
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
 * //     CountingServiceBatchParameters: {
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
 * @param ExportAccountSettingsCommandInput - {@link ExportAccountSettingsCommandInput}
 * @returns {@link ExportAccountSettingsCommandOutput}
 * @see {@link ExportAccountSettingsCommandInput} for command's `input` shape.
 * @see {@link ExportAccountSettingsCommandOutput} for command's `response` shape.
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
export declare class ExportAccountSettingsCommand extends ExportAccountSettingsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ExportAccountSettingsRequest;
            output: ExportAccountSettingsResponse;
        };
        sdk: {
            input: ExportAccountSettingsCommandInput;
            output: ExportAccountSettingsCommandOutput;
        };
    };
}
