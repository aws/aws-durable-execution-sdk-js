import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetPublicAccessBlockConfigRequest, GetPublicAccessBlockConfigResponse } from "../models/models_0";
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
 * The input for {@link GetPublicAccessBlockConfigCommand}.
 */
export interface GetPublicAccessBlockConfigCommandInput extends GetPublicAccessBlockConfigRequest {
}
/**
 * @public
 *
 * The output of {@link GetPublicAccessBlockConfigCommand}.
 */
export interface GetPublicAccessBlockConfigCommandOutput extends GetPublicAccessBlockConfigResponse, __MetadataBearer {
}
declare const GetPublicAccessBlockConfigCommand_base: {
    new (input: GetPublicAccessBlockConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetPublicAccessBlockConfigCommandInput, GetPublicAccessBlockConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetPublicAccessBlockConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetPublicAccessBlockConfigCommandInput, GetPublicAccessBlockConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetPublicAccessBlockConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetPublicAccessBlockConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetPublicAccessBlockConfigRequest
 *   ResourceArn: "STRING_VALUE", // required
 * };
 * const command = new GetPublicAccessBlockConfigCommand(input);
 * const response = await client.send(command);
 * // { // GetPublicAccessBlockConfigResponse
 * //   PublicAccessBlockConfig: { // PublicAccessBlockConfig
 * //     BlockPublicPolicy: true || false,
 * //     RestrictPublicResource: true || false,
 * //   },
 * // };
 *
 * ```
 *
 * @param GetPublicAccessBlockConfigCommandInput - {@link GetPublicAccessBlockConfigCommandInput}
 * @returns {@link GetPublicAccessBlockConfigCommandOutput}
 * @see {@link GetPublicAccessBlockConfigCommandInput} for command's `input` shape.
 * @see {@link GetPublicAccessBlockConfigCommandOutput} for command's `response` shape.
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
export declare class GetPublicAccessBlockConfigCommand extends GetPublicAccessBlockConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetPublicAccessBlockConfigRequest;
            output: GetPublicAccessBlockConfigResponse;
        };
        sdk: {
            input: GetPublicAccessBlockConfigCommandInput;
            output: GetPublicAccessBlockConfigCommandOutput;
        };
    };
}
