import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteMigratedLayerVersionRequest } from "../models/models_0";
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
 * The input for {@link DeleteMigratedLayerVersionCommand}.
 */
export interface DeleteMigratedLayerVersionCommandInput extends DeleteMigratedLayerVersionRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteMigratedLayerVersionCommand}.
 */
export interface DeleteMigratedLayerVersionCommandOutput extends __MetadataBearer {
}
declare const DeleteMigratedLayerVersionCommand_base: {
    new (input: DeleteMigratedLayerVersionCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteMigratedLayerVersionCommandInput, DeleteMigratedLayerVersionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteMigratedLayerVersionCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteMigratedLayerVersionCommandInput, DeleteMigratedLayerVersionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteMigratedLayerVersionCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteMigratedLayerVersionCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteMigratedLayerVersionRequest
 *   LayerVersionArn: "STRING_VALUE", // required
 * };
 * const command = new DeleteMigratedLayerVersionCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DeleteMigratedLayerVersionCommandInput - {@link DeleteMigratedLayerVersionCommandInput}
 * @returns {@link DeleteMigratedLayerVersionCommandOutput}
 * @see {@link DeleteMigratedLayerVersionCommandInput} for command's `input` shape.
 * @see {@link DeleteMigratedLayerVersionCommandOutput} for command's `response` shape.
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
export declare class DeleteMigratedLayerVersionCommand extends DeleteMigratedLayerVersionCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteMigratedLayerVersionRequest;
            output: {};
        };
        sdk: {
            input: DeleteMigratedLayerVersionCommandInput;
            output: DeleteMigratedLayerVersionCommandOutput;
        };
    };
}
