import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetAccountSettingsRequest20150331, GetAccountSettingsResponse20150331 } from "../models/models_0";
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
 * The input for {@link GetAccountSettings20150331Command}.
 */
export interface GetAccountSettings20150331CommandInput extends GetAccountSettingsRequest20150331 {
}
/**
 * @public
 *
 * The output of {@link GetAccountSettings20150331Command}.
 */
export interface GetAccountSettings20150331CommandOutput extends GetAccountSettingsResponse20150331, __MetadataBearer {
}
declare const GetAccountSettings20150331Command_base: {
    new (input: GetAccountSettings20150331CommandInput): import("@smithy/smithy-client").CommandImpl<GetAccountSettings20150331CommandInput, GetAccountSettings20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (...[input]: [] | [GetAccountSettings20150331CommandInput]): import("@smithy/smithy-client").CommandImpl<GetAccountSettings20150331CommandInput, GetAccountSettings20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetAccountSettings20150331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetAccountSettings20150331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = {};
 * const command = new GetAccountSettings20150331Command(input);
 * const response = await client.send(command);
 * // { // GetAccountSettingsResponse20150331
 * //   SupportedFeatures: [ // FeatureList
 * //     "STRING_VALUE",
 * //   ],
 * //   FunctionCount: Number("long"),
 * //   CodeStorage: Number("long"),
 * //   CodeStorageLimit: Number("long"),
 * //   AliasCount: Number("long"),
 * //   AliasCountLimit: Number("long"),
 * // };
 *
 * ```
 *
 * @param GetAccountSettings20150331CommandInput - {@link GetAccountSettings20150331CommandInput}
 * @returns {@link GetAccountSettings20150331CommandOutput}
 * @see {@link GetAccountSettings20150331CommandInput} for command's `input` shape.
 * @see {@link GetAccountSettings20150331CommandOutput} for command's `response` shape.
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
export declare class GetAccountSettings20150331Command extends GetAccountSettings20150331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: {};
            output: GetAccountSettingsResponse20150331;
        };
        sdk: {
            input: GetAccountSettings20150331CommandInput;
            output: GetAccountSettings20150331CommandOutput;
        };
    };
}
