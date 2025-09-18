import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { SetAccountSettingsRequest20170430, SetAccountSettingsResponse20170430 } from "../models/models_1";
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
 * The input for {@link SetAccountSettings20170430Command}.
 */
export interface SetAccountSettings20170430CommandInput extends SetAccountSettingsRequest20170430 {
}
/**
 * @public
 *
 * The output of {@link SetAccountSettings20170430Command}.
 */
export interface SetAccountSettings20170430CommandOutput extends SetAccountSettingsResponse20170430, __MetadataBearer {
}
declare const SetAccountSettings20170430Command_base: {
    new (input: SetAccountSettings20170430CommandInput): import("@smithy/smithy-client").CommandImpl<SetAccountSettings20170430CommandInput, SetAccountSettings20170430CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (...[input]: [] | [SetAccountSettings20170430CommandInput]): import("@smithy/smithy-client").CommandImpl<SetAccountSettings20170430CommandInput, SetAccountSettings20170430CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, SetAccountSettings20170430Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, SetAccountSettings20170430Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // SetAccountSettingsRequest20170430
 *   DeprecatedFeaturesAccess: [ // FeatureList
 *     "STRING_VALUE",
 *   ],
 * };
 * const command = new SetAccountSettings20170430Command(input);
 * const response = await client.send(command);
 * // { // SetAccountSettingsResponse20170430
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
 * // };
 *
 * ```
 *
 * @param SetAccountSettings20170430CommandInput - {@link SetAccountSettings20170430CommandInput}
 * @returns {@link SetAccountSettings20170430CommandOutput}
 * @see {@link SetAccountSettings20170430CommandInput} for command's `input` shape.
 * @see {@link SetAccountSettings20170430CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
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
export declare class SetAccountSettings20170430Command extends SetAccountSettings20170430Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: SetAccountSettingsRequest20170430;
            output: SetAccountSettingsResponse20170430;
        };
        sdk: {
            input: SetAccountSettings20170430CommandInput;
            output: SetAccountSettings20170430CommandOutput;
        };
    };
}
