import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ImportAccountSettingsRequest, ImportAccountSettingsResponse } from "../models/models_0";
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
 * The input for {@link ImportAccountSettingsCommand}.
 */
export interface ImportAccountSettingsCommandInput extends ImportAccountSettingsRequest {
}
/**
 * @public
 *
 * The output of {@link ImportAccountSettingsCommand}.
 */
export interface ImportAccountSettingsCommandOutput extends ImportAccountSettingsResponse, __MetadataBearer {
}
declare const ImportAccountSettingsCommand_base: {
    new (input: ImportAccountSettingsCommandInput): import("@smithy/smithy-client").CommandImpl<ImportAccountSettingsCommandInput, ImportAccountSettingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ImportAccountSettingsCommandInput): import("@smithy/smithy-client").CommandImpl<ImportAccountSettingsCommandInput, ImportAccountSettingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ImportAccountSettingsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ImportAccountSettingsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ImportAccountSettingsRequest
 *   AccountId: "STRING_VALUE", // required
 *   CodeStorageTableEntry: { // CodeStorageTableEntry
 *     AliasCount: Number("long"),
 *     FunctionCount: Number("long"),
 *     CodeSizeBytes: Number("long"),
 *   },
 *   CustomerConfig: { // CustomerConfigInternal
 *     AccountId: "STRING_VALUE",
 *     CellId: "STRING_VALUE",
 *     ControlAPIThrottleLimit: Number("int"),
 *     DeprecatedFeaturesControlAccess: [ // FeatureList
 *       "STRING_VALUE",
 *     ],
 *     DeprecatedFeaturesInvokeAccess: [
 *       "STRING_VALUE",
 *     ],
 *     Enabled: true || false,
 *     EniLimit: Number("int"),
 *     EniVpcLimits: { // EniVpc
 *       "<keys>": Number("int"),
 *     },
 *     EventSourceMappingRestrictions: [ // MappingRestrictions
 *       "STRING_VALUE",
 *     ],
 *     GetFunctionAPIThrottleLimit: Number("int"),
 *     GetPolicyAPIThrottleLimit: Number("int"),
 *     InvokeAsyncThrottleLimit: Number("int"),
 *     LargeCloudFunctionConcurrencyLimit: Number("int"),
 *     MaxQueueDepth: Number("int"),
 *     PreviewFeatures: [
 *       "STRING_VALUE",
 *     ],
 *     DenyListFeatures: [
 *       "STRING_VALUE",
 *     ],
 *     RequestSignerInvokeTpsLimitOverride: Number("int"),
 *     RuntimesPinnedToAL1703ByDefaultOnCreate: [ // AL1703Runtimes
 *       "STRING_VALUE",
 *     ],
 *     RuntimesPinnedToAL1703ByDefaultOnUpdate: [
 *       "STRING_VALUE",
 *     ],
 *     SmallCloudFunctionConcurrencyLimit: Number("int"),
 *     SqsQueueName: "STRING_VALUE",
 *     UnreservedConcurrentExecutions: Number("int"),
 *     UnreservedConcurrentExecutionsMinimum: Number("int"),
 *     VersionString: "STRING_VALUE", // required
 *     MigrationStatus: "STRING_VALUE",
 *     AliasLimit: Number("long"),
 *     ArcScalingParameters: { // Map
 *       "<keys>": "STRING_VALUE",
 *     },
 *     TotalCodeSizeLimit: Number("long"),
 *     AccountStatus: "STRING_VALUE",
 *     AccountStatusTimestampAsEpochMilli: Number("long"),
 *     AccountStatusEvent: "STRING_VALUE",
 *     ConcurrencySequenceNumber: Number("long"),
 *     CountingServiceBatchDivisor: Number("int"),
 *     CountingServiceBatchParameters: { // MapStringToInteger
 *       "<keys>": Number("int"),
 *     },
 *     SplitCountParameters: { // MapStringToLong
 *       "<keys>": Number("long"),
 *     },
 *     ProvisionedConcurrencyPreWarmingRate: Number("int"),
 *     FunctionMemorySizeLimit: Number("int"),
 *     AccountRiskMetadata: {
 *       "<keys>": Number("int"),
 *     },
 *     AccountRiskStatusTimestamp: new Date("TIMESTAMP"),
 *     AccountRiskSource: "STRING_VALUE",
 *     ShardPoolParameters: {
 *       "<keys>": Number("long"),
 *     },
 *     Features: [ // Features
 *       { // FeaturesListItem
 *         FeatureName: "STRING_VALUE",
 *         FeatureStatus: "Accessible" || "Inaccessible",
 *       },
 *     ],
 *   },
 *   RiskSettings: { // MigrationAccountRiskSettings
 *     RiskDetectedTime: new Date("TIMESTAMP"),
 *     RiskSource: "STRING_VALUE",
 *     AccountRiskMetadata: {
 *       "<keys>": Number("int"),
 *     },
 *   },
 * };
 * const command = new ImportAccountSettingsCommand(input);
 * const response = await client.send(command);
 * // { // ImportAccountSettingsResponse
 * //   CodeStorageTableEntry: { // CodeStorageTableEntry
 * //     AliasCount: Number("long"),
 * //     FunctionCount: Number("long"),
 * //     CodeSizeBytes: Number("long"),
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
 * //   RiskSettings: { // MigrationAccountRiskSettings
 * //     RiskDetectedTime: new Date("TIMESTAMP"),
 * //     RiskSource: "STRING_VALUE",
 * //     AccountRiskMetadata: {
 * //       "<keys>": Number("int"),
 * //     },
 * //   },
 * // };
 *
 * ```
 *
 * @param ImportAccountSettingsCommandInput - {@link ImportAccountSettingsCommandInput}
 * @returns {@link ImportAccountSettingsCommandOutput}
 * @see {@link ImportAccountSettingsCommandInput} for command's `input` shape.
 * @see {@link ImportAccountSettingsCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link PreconditionFailedException} (client fault)
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
export declare class ImportAccountSettingsCommand extends ImportAccountSettingsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ImportAccountSettingsRequest;
            output: ImportAccountSettingsResponse;
        };
        sdk: {
            input: ImportAccountSettingsCommandInput;
            output: ImportAccountSettingsCommandOutput;
        };
    };
}
