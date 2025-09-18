import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { AliasConfiguration20150331 } from "../models/models_0";
import { UpdateAliasRequest20150331 } from "../models/models_1";
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
 * The input for {@link UpdateAlias20150331Command}.
 */
export interface UpdateAlias20150331CommandInput extends UpdateAliasRequest20150331 {
}
/**
 * @public
 *
 * The output of {@link UpdateAlias20150331Command}.
 */
export interface UpdateAlias20150331CommandOutput extends AliasConfiguration20150331, __MetadataBearer {
}
declare const UpdateAlias20150331Command_base: {
    new (input: UpdateAlias20150331CommandInput): import("@smithy/smithy-client").CommandImpl<UpdateAlias20150331CommandInput, UpdateAlias20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: UpdateAlias20150331CommandInput): import("@smithy/smithy-client").CommandImpl<UpdateAlias20150331CommandInput, UpdateAlias20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, UpdateAlias20150331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, UpdateAlias20150331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // UpdateAliasRequest20150331
 *   FunctionName: "STRING_VALUE", // required
 *   Name: "STRING_VALUE", // required
 *   FunctionVersion: "STRING_VALUE",
 *   Description: "STRING_VALUE",
 *   RoutingConfig: { // AliasRoutingConfiguration
 *     AdditionalVersionWeights: { // AdditionalVersionWeights
 *       "<keys>": Number("double"),
 *     },
 *   },
 *   RevisionId: "STRING_VALUE",
 * };
 * const command = new UpdateAlias20150331Command(input);
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
 * @param UpdateAlias20150331CommandInput - {@link UpdateAlias20150331CommandInput}
 * @returns {@link UpdateAlias20150331CommandOutput}
 * @see {@link UpdateAlias20150331CommandInput} for command's `input` shape.
 * @see {@link UpdateAlias20150331CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link PreconditionFailedException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
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
export declare class UpdateAlias20150331Command extends UpdateAlias20150331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: UpdateAliasRequest20150331;
            output: AliasConfiguration20150331;
        };
        sdk: {
            input: UpdateAlias20150331CommandInput;
            output: UpdateAlias20150331CommandOutput;
        };
    };
}
