import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { RollbackTagsOwnershipFromLambdaRequest, RollbackTagsOwnershipFromLambdaResponse } from "../models/models_1";
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
 * The input for {@link RollbackTagsOwnershipFromLambdaCommand}.
 */
export interface RollbackTagsOwnershipFromLambdaCommandInput extends RollbackTagsOwnershipFromLambdaRequest {
}
/**
 * @public
 *
 * The output of {@link RollbackTagsOwnershipFromLambdaCommand}.
 */
export interface RollbackTagsOwnershipFromLambdaCommandOutput extends RollbackTagsOwnershipFromLambdaResponse, __MetadataBearer {
}
declare const RollbackTagsOwnershipFromLambdaCommand_base: {
    new (input: RollbackTagsOwnershipFromLambdaCommandInput): import("@smithy/smithy-client").CommandImpl<RollbackTagsOwnershipFromLambdaCommandInput, RollbackTagsOwnershipFromLambdaCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: RollbackTagsOwnershipFromLambdaCommandInput): import("@smithy/smithy-client").CommandImpl<RollbackTagsOwnershipFromLambdaCommandInput, RollbackTagsOwnershipFromLambdaCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, RollbackTagsOwnershipFromLambdaCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, RollbackTagsOwnershipFromLambdaCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // RollbackTagsOwnershipFromLambdaRequest
 *   FunctionArn: "STRING_VALUE", // required
 * };
 * const command = new RollbackTagsOwnershipFromLambdaCommand(input);
 * const response = await client.send(command);
 * // { // RollbackTagsOwnershipFromLambdaResponse
 * //   HasTagsOwnershipTransferOccurred: true || false, // required
 * //   ValidationToken: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param RollbackTagsOwnershipFromLambdaCommandInput - {@link RollbackTagsOwnershipFromLambdaCommandInput}
 * @returns {@link RollbackTagsOwnershipFromLambdaCommandOutput}
 * @see {@link RollbackTagsOwnershipFromLambdaCommandInput} for command's `input` shape.
 * @see {@link RollbackTagsOwnershipFromLambdaCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link PreconditionFailedException} (client fault)
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
export declare class RollbackTagsOwnershipFromLambdaCommand extends RollbackTagsOwnershipFromLambdaCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: RollbackTagsOwnershipFromLambdaRequest;
            output: RollbackTagsOwnershipFromLambdaResponse;
        };
        sdk: {
            input: RollbackTagsOwnershipFromLambdaCommandInput;
            output: RollbackTagsOwnershipFromLambdaCommandOutput;
        };
    };
}
