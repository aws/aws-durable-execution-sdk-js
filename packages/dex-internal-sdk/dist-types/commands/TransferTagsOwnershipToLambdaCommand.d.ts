import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { TransferTagsOwnershipToLambdaRequest, TransferTagsOwnershipToLambdaResponse } from "../models/models_1";
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
 * The input for {@link TransferTagsOwnershipToLambdaCommand}.
 */
export interface TransferTagsOwnershipToLambdaCommandInput extends TransferTagsOwnershipToLambdaRequest {
}
/**
 * @public
 *
 * The output of {@link TransferTagsOwnershipToLambdaCommand}.
 */
export interface TransferTagsOwnershipToLambdaCommandOutput extends TransferTagsOwnershipToLambdaResponse, __MetadataBearer {
}
declare const TransferTagsOwnershipToLambdaCommand_base: {
    new (input: TransferTagsOwnershipToLambdaCommandInput): import("@smithy/smithy-client").CommandImpl<TransferTagsOwnershipToLambdaCommandInput, TransferTagsOwnershipToLambdaCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: TransferTagsOwnershipToLambdaCommandInput): import("@smithy/smithy-client").CommandImpl<TransferTagsOwnershipToLambdaCommandInput, TransferTagsOwnershipToLambdaCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, TransferTagsOwnershipToLambdaCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, TransferTagsOwnershipToLambdaCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // TransferTagsOwnershipToLambdaRequest
 *   FunctionArn: "STRING_VALUE", // required
 * };
 * const command = new TransferTagsOwnershipToLambdaCommand(input);
 * const response = await client.send(command);
 * // { // TransferTagsOwnershipToLambdaResponse
 * //   HasTagsOwnershipTransferOccurred: true || false, // required
 * // };
 *
 * ```
 *
 * @param TransferTagsOwnershipToLambdaCommandInput - {@link TransferTagsOwnershipToLambdaCommandInput}
 * @returns {@link TransferTagsOwnershipToLambdaCommandOutput}
 * @see {@link TransferTagsOwnershipToLambdaCommandInput} for command's `input` shape.
 * @see {@link TransferTagsOwnershipToLambdaCommandOutput} for command's `response` shape.
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
export declare class TransferTagsOwnershipToLambdaCommand extends TransferTagsOwnershipToLambdaCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: TransferTagsOwnershipToLambdaRequest;
            output: TransferTagsOwnershipToLambdaResponse;
        };
        sdk: {
            input: TransferTagsOwnershipToLambdaCommandInput;
            output: TransferTagsOwnershipToLambdaCommandOutput;
        };
    };
}
