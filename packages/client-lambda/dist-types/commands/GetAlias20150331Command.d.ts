import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { AliasConfiguration20150331, GetAliasRequest20150331 } from "../models/models_0";
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
 * The input for {@link GetAlias20150331Command}.
 */
export interface GetAlias20150331CommandInput extends GetAliasRequest20150331 {
}
/**
 * @public
 *
 * The output of {@link GetAlias20150331Command}.
 */
export interface GetAlias20150331CommandOutput extends AliasConfiguration20150331, __MetadataBearer {
}
declare const GetAlias20150331Command_base: {
    new (input: GetAlias20150331CommandInput): import("@smithy/smithy-client").CommandImpl<GetAlias20150331CommandInput, GetAlias20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetAlias20150331CommandInput): import("@smithy/smithy-client").CommandImpl<GetAlias20150331CommandInput, GetAlias20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetAlias20150331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetAlias20150331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetAliasRequest20150331
 *   FunctionName: "STRING_VALUE", // required
 *   Name: "STRING_VALUE", // required
 * };
 * const command = new GetAlias20150331Command(input);
 * const response = await client.send(command);
 * // { // AliasConfiguration20150331
 * //   AliasArn: "STRING_VALUE",
 * //   Name: "STRING_VALUE",
 * //   FunctionVersion: "STRING_VALUE",
 * //   Description: "STRING_VALUE",
 * //   RoutingConfig: { // AliasRoutingConfiguration
 * //     AdditionalVersionWeights: { // AdditionalVersionWeights
 * //       "<keys>": Number("double"),
 * //     },
 * //   },
 * //   RevisionId: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param GetAlias20150331CommandInput - {@link GetAlias20150331CommandInput}
 * @returns {@link GetAlias20150331CommandOutput}
 * @see {@link GetAlias20150331CommandInput} for command's `input` shape.
 * @see {@link GetAlias20150331CommandOutput} for command's `response` shape.
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
export declare class GetAlias20150331Command extends GetAlias20150331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetAliasRequest20150331;
            output: AliasConfiguration20150331;
        };
        sdk: {
            input: GetAlias20150331CommandInput;
            output: GetAlias20150331CommandOutput;
        };
    };
}
