import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetLayerVersionPolicyInternalRequest, GetLayerVersionPolicyInternalResponse } from "../models/models_0";
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
 * The input for {@link GetLayerVersionPolicyInternalCommand}.
 */
export interface GetLayerVersionPolicyInternalCommandInput extends GetLayerVersionPolicyInternalRequest {
}
/**
 * @public
 *
 * The output of {@link GetLayerVersionPolicyInternalCommand}.
 */
export interface GetLayerVersionPolicyInternalCommandOutput extends GetLayerVersionPolicyInternalResponse, __MetadataBearer {
}
declare const GetLayerVersionPolicyInternalCommand_base: {
    new (input: GetLayerVersionPolicyInternalCommandInput): import("@smithy/smithy-client").CommandImpl<GetLayerVersionPolicyInternalCommandInput, GetLayerVersionPolicyInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetLayerVersionPolicyInternalCommandInput): import("@smithy/smithy-client").CommandImpl<GetLayerVersionPolicyInternalCommandInput, GetLayerVersionPolicyInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetLayerVersionPolicyInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetLayerVersionPolicyInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetLayerVersionPolicyInternalRequest
 *   LayerVersionArn: "STRING_VALUE", // required
 * };
 * const command = new GetLayerVersionPolicyInternalCommand(input);
 * const response = await client.send(command);
 * // { // GetLayerVersionPolicyInternalResponse
 * //   Policy: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param GetLayerVersionPolicyInternalCommandInput - {@link GetLayerVersionPolicyInternalCommandInput}
 * @returns {@link GetLayerVersionPolicyInternalCommandOutput}
 * @see {@link GetLayerVersionPolicyInternalCommandInput} for command's `input` shape.
 * @see {@link GetLayerVersionPolicyInternalCommandOutput} for command's `response` shape.
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
export declare class GetLayerVersionPolicyInternalCommand extends GetLayerVersionPolicyInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetLayerVersionPolicyInternalRequest;
            output: GetLayerVersionPolicyInternalResponse;
        };
        sdk: {
            input: GetLayerVersionPolicyInternalCommandInput;
            output: GetLayerVersionPolicyInternalCommandOutput;
        };
    };
}
