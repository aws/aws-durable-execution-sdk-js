import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteFunctionVersionResourcesInternalRequest, DeleteFunctionVersionResourcesInternalResponse } from "../models/models_0";
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
 * The input for {@link DeleteFunctionVersionResourcesInternalCommand}.
 */
export interface DeleteFunctionVersionResourcesInternalCommandInput extends DeleteFunctionVersionResourcesInternalRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteFunctionVersionResourcesInternalCommand}.
 */
export interface DeleteFunctionVersionResourcesInternalCommandOutput extends DeleteFunctionVersionResourcesInternalResponse, __MetadataBearer {
}
declare const DeleteFunctionVersionResourcesInternalCommand_base: {
    new (input: DeleteFunctionVersionResourcesInternalCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionVersionResourcesInternalCommandInput, DeleteFunctionVersionResourcesInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteFunctionVersionResourcesInternalCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteFunctionVersionResourcesInternalCommandInput, DeleteFunctionVersionResourcesInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteFunctionVersionResourcesInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteFunctionVersionResourcesInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteFunctionVersionResourcesInternalRequest
 *   FunctionArn: "STRING_VALUE", // required
 * };
 * const command = new DeleteFunctionVersionResourcesInternalCommand(input);
 * const response = await client.send(command);
 * // { // DeleteFunctionVersionResourcesInternalResponse
 * //   VpcConfigResponse: { // VpcConfigResponse
 * //     SubnetIds: [ // SubnetIds
 * //       "STRING_VALUE",
 * //     ],
 * //     SecurityGroupIds: [ // SecurityGroupIds
 * //       "STRING_VALUE",
 * //     ],
 * //     VpcId: "STRING_VALUE",
 * //     Ipv6AllowedForDualStack: true || false,
 * //     VpcDelegationRole: "STRING_VALUE",
 * //     VpcOwnerRole: "STRING_VALUE",
 * //     TargetSourceArn: "STRING_VALUE",
 * //   },
 * // };
 *
 * ```
 *
 * @param DeleteFunctionVersionResourcesInternalCommandInput - {@link DeleteFunctionVersionResourcesInternalCommandInput}
 * @returns {@link DeleteFunctionVersionResourcesInternalCommandOutput}
 * @see {@link DeleteFunctionVersionResourcesInternalCommandInput} for command's `input` shape.
 * @see {@link DeleteFunctionVersionResourcesInternalCommandOutput} for command's `response` shape.
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
export declare class DeleteFunctionVersionResourcesInternalCommand extends DeleteFunctionVersionResourcesInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteFunctionVersionResourcesInternalRequest;
            output: DeleteFunctionVersionResourcesInternalResponse;
        };
        sdk: {
            input: DeleteFunctionVersionResourcesInternalCommandInput;
            output: DeleteFunctionVersionResourcesInternalCommandOutput;
        };
    };
}
