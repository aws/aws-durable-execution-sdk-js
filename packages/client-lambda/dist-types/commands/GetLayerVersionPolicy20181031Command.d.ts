import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetLayerVersionPolicyRequest20181031, GetLayerVersionPolicyResponse20181031 } from "../models/models_0";
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
 * The input for {@link GetLayerVersionPolicy20181031Command}.
 */
export interface GetLayerVersionPolicy20181031CommandInput extends GetLayerVersionPolicyRequest20181031 {
}
/**
 * @public
 *
 * The output of {@link GetLayerVersionPolicy20181031Command}.
 */
export interface GetLayerVersionPolicy20181031CommandOutput extends GetLayerVersionPolicyResponse20181031, __MetadataBearer {
}
declare const GetLayerVersionPolicy20181031Command_base: {
    new (input: GetLayerVersionPolicy20181031CommandInput): import("@smithy/smithy-client").CommandImpl<GetLayerVersionPolicy20181031CommandInput, GetLayerVersionPolicy20181031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetLayerVersionPolicy20181031CommandInput): import("@smithy/smithy-client").CommandImpl<GetLayerVersionPolicy20181031CommandInput, GetLayerVersionPolicy20181031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetLayerVersionPolicy20181031Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetLayerVersionPolicy20181031Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetLayerVersionPolicyRequest20181031
 *   LayerName: "STRING_VALUE", // required
 *   VersionNumber: Number("long"), // required
 * };
 * const command = new GetLayerVersionPolicy20181031Command(input);
 * const response = await client.send(command);
 * // { // GetLayerVersionPolicyResponse20181031
 * //   Policy: "STRING_VALUE",
 * //   RevisionId: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param GetLayerVersionPolicy20181031CommandInput - {@link GetLayerVersionPolicy20181031CommandInput}
 * @returns {@link GetLayerVersionPolicy20181031CommandOutput}
 * @see {@link GetLayerVersionPolicy20181031CommandInput} for command's `input` shape.
 * @see {@link GetLayerVersionPolicy20181031CommandOutput} for command's `response` shape.
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
export declare class GetLayerVersionPolicy20181031Command extends GetLayerVersionPolicy20181031Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetLayerVersionPolicyRequest20181031;
            output: GetLayerVersionPolicyResponse20181031;
        };
        sdk: {
            input: GetLayerVersionPolicy20181031CommandInput;
            output: GetLayerVersionPolicy20181031CommandOutput;
        };
    };
}
