import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteAccountSettingsInternalRequest } from "../models/models_0";
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
 * The input for {@link DeleteAccountSettingsInternalCommand}.
 */
export interface DeleteAccountSettingsInternalCommandInput extends DeleteAccountSettingsInternalRequest {
}
/**
 * @public
 *
 * The output of {@link DeleteAccountSettingsInternalCommand}.
 */
export interface DeleteAccountSettingsInternalCommandOutput extends __MetadataBearer {
}
declare const DeleteAccountSettingsInternalCommand_base: {
    new (input: DeleteAccountSettingsInternalCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteAccountSettingsInternalCommandInput, DeleteAccountSettingsInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteAccountSettingsInternalCommandInput): import("@smithy/smithy-client").CommandImpl<DeleteAccountSettingsInternalCommandInput, DeleteAccountSettingsInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteAccountSettingsInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteAccountSettingsInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteAccountSettingsInternalRequest
 *   AccountId: "STRING_VALUE", // required
 * };
 * const command = new DeleteAccountSettingsInternalCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DeleteAccountSettingsInternalCommandInput - {@link DeleteAccountSettingsInternalCommandInput}
 * @returns {@link DeleteAccountSettingsInternalCommandOutput}
 * @see {@link DeleteAccountSettingsInternalCommandInput} for command's `input` shape.
 * @see {@link DeleteAccountSettingsInternalCommandOutput} for command's `response` shape.
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
export declare class DeleteAccountSettingsInternalCommand extends DeleteAccountSettingsInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteAccountSettingsInternalRequest;
            output: {};
        };
        sdk: {
            input: DeleteAccountSettingsInternalCommandInput;
            output: DeleteAccountSettingsInternalCommandOutput;
        };
    };
}
