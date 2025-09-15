import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { InformTagrisAfterResourceCreationRequest } from "../models/models_1";
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
 * The input for {@link InformTagrisAfterResourceCreationCommand}.
 */
export interface InformTagrisAfterResourceCreationCommandInput extends InformTagrisAfterResourceCreationRequest {
}
/**
 * @public
 *
 * The output of {@link InformTagrisAfterResourceCreationCommand}.
 */
export interface InformTagrisAfterResourceCreationCommandOutput extends __MetadataBearer {
}
declare const InformTagrisAfterResourceCreationCommand_base: {
    new (input: InformTagrisAfterResourceCreationCommandInput): import("@smithy/smithy-client").CommandImpl<InformTagrisAfterResourceCreationCommandInput, InformTagrisAfterResourceCreationCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: InformTagrisAfterResourceCreationCommandInput): import("@smithy/smithy-client").CommandImpl<InformTagrisAfterResourceCreationCommandInput, InformTagrisAfterResourceCreationCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, InformTagrisAfterResourceCreationCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, InformTagrisAfterResourceCreationCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // InformTagrisAfterResourceCreationRequest
 *   Resource: "STRING_VALUE", // required
 *   TagrisExpectedVersion: Number("long"), // required
 * };
 * const command = new InformTagrisAfterResourceCreationCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param InformTagrisAfterResourceCreationCommandInput - {@link InformTagrisAfterResourceCreationCommandInput}
 * @returns {@link InformTagrisAfterResourceCreationCommandOutput}
 * @see {@link InformTagrisAfterResourceCreationCommandInput} for command's `input` shape.
 * @see {@link InformTagrisAfterResourceCreationCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ServiceException} (server fault)
 *
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class InformTagrisAfterResourceCreationCommand extends InformTagrisAfterResourceCreationCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: InformTagrisAfterResourceCreationRequest;
            output: {};
        };
        sdk: {
            input: InformTagrisAfterResourceCreationCommandInput;
            output: InformTagrisAfterResourceCreationCommandOutput;
        };
    };
}
