import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteCodeSigningConfigRequest, DeleteCodeSigningConfigResponse } from "../models/models_0";
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
 * The input for {@link DeleteCodeSigningConfigCommand}.
 */
export interface DeleteCodeSigningConfigCommandInput extends DeleteCodeSigningConfigRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteCodeSigningConfigCommand}.
 */
export interface DeleteCodeSigningConfigCommandOutput extends DeleteCodeSigningConfigResponse, __MetadataBearer {
}
declare const DeleteCodeSigningConfigCommand_base: {
    new (input: DeleteCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteCodeSigningConfigCommandInput, DeleteCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteCodeSigningConfigCommandInput, DeleteCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteCodeSigningConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteCodeSigningConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteCodeSigningConfigRequest
 *   CodeSigningConfigArn: "STRING_VALUE", // required
 * };
 * const command = new DeleteCodeSigningConfigCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DeleteCodeSigningConfigCommandInput - {@link DeleteCodeSigningConfigCommandInput}
 * @returns {@link DeleteCodeSigningConfigCommandOutput}
 * @see {@link DeleteCodeSigningConfigCommandInput} for command's `input` shape.
 * @see {@link DeleteCodeSigningConfigCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ResourceNotFoundException} (client fault)
 *
 * @throws {@link ServiceException} (server fault)
 *
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class DeleteCodeSigningConfigCommand extends DeleteCodeSigningConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteCodeSigningConfigRequest;
            output: {};
        };
        sdk: {
            input: DeleteCodeSigningConfigCommandInput;
            output: DeleteCodeSigningConfigCommandOutput;
        };
    };
}
