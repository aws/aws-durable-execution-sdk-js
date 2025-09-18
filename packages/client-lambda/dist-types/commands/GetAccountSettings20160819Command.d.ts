import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetAccountSettingsRequest20160819, GetAccountSettingsResponse20160819 } from "../models/models_0";
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
 * The input for {@link GetAccountSettings20160819Command}.
 */
export interface GetAccountSettings20160819CommandInput extends GetAccountSettingsRequest20160819 {
}
/**
 * @public
 *
 * The output of {@link GetAccountSettings20160819Command}.
 */
export interface GetAccountSettings20160819CommandOutput extends GetAccountSettingsResponse20160819, __MetadataBearer {
}
declare const GetAccountSettings20160819Command_base: {
    new (input: GetAccountSettings20160819CommandInput): import("@smithy/smithy-client").CommandImpl<GetAccountSettings20160819CommandInput, GetAccountSettings20160819CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (...[input]: [] | [GetAccountSettings20160819CommandInput]): import("@smithy/smithy-client").CommandImpl<GetAccountSettings20160819CommandInput, GetAccountSettings20160819CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetAccountSettings20160819Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetAccountSettings20160819Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetAccountSettingsRequest20160819
 *   IncludePreviewFeatures: true || false,
 *   IncludeDeprecatedFeaturesAccess: true || false,
 *   IncludeDeprecatedRuntimeDetails: true || false,
 *   IncludeUnreservedConcurrentExecutionsMinimum: true || false,
 *   IncludeBlacklistedFeatures: true || false,
 * };
 * const command = new GetAccountSettings20160819Command(input);
 * const response = await client.send(command);
 * // { // GetAccountSettingsResponse20160819
 * //   AccountLimit: { // AccountLimit
 * //     TotalCodeSize: Number("long"),
 * //     CodeSizeUnzipped: Number("long"),
 * //     CodeSizeZipped: Number("long"),
 * //     ConcurrentExecutions: Number("int"),
 * //     UnreservedConcurrentExecutions: Number("int"),
 * //     UnreservedConcurrentExecutionsMinimum: Number("int"),
 * //   },
 * //   AccountUsage: { // AccountUsage
 * //     TotalCodeSize: Number("long"),
 * //     FunctionCount: Number("long"),
 * //   },
 * //   PreviewFeatures: [ // FeatureList
 * //     "STRING_VALUE",
 * //   ],
 * //   DeprecatedFeaturesAccess: [
 * //     "STRING_VALUE",
 * //   ],
 * //   HasFunctionWithDeprecatedRuntime: true || false,
 * //   BlacklistedFeatures: [
 * //     "STRING_VALUE",
 * //   ],
 * // };
 *
 * ```
 *
 * @param GetAccountSettings20160819CommandInput - {@link GetAccountSettings20160819CommandInput}
 * @returns {@link GetAccountSettings20160819CommandOutput}
 * @see {@link GetAccountSettings20160819CommandInput} for command's `input` shape.
 * @see {@link GetAccountSettings20160819CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
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
export declare class GetAccountSettings20160819Command extends GetAccountSettings20160819Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetAccountSettingsRequest20160819;
            output: GetAccountSettingsResponse20160819;
        };
        sdk: {
            input: GetAccountSettings20160819CommandInput;
            output: GetAccountSettings20160819CommandOutput;
        };
    };
}
