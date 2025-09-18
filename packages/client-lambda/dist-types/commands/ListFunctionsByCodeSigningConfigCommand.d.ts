import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListFunctionsByCodeSigningConfigRequest, ListFunctionsByCodeSigningConfigResponse } from "../models/models_1";
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
 * The input for {@link ListFunctionsByCodeSigningConfigCommand}.
 */
export interface ListFunctionsByCodeSigningConfigCommandInput extends ListFunctionsByCodeSigningConfigRequest {
}
/**
 * @public
 *
 * The output of {@link ListFunctionsByCodeSigningConfigCommand}.
 */
export interface ListFunctionsByCodeSigningConfigCommandOutput extends ListFunctionsByCodeSigningConfigResponse, __MetadataBearer {
}
declare const ListFunctionsByCodeSigningConfigCommand_base: {
    new (input: ListFunctionsByCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionsByCodeSigningConfigCommandInput, ListFunctionsByCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListFunctionsByCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionsByCodeSigningConfigCommandInput, ListFunctionsByCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListFunctionsByCodeSigningConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListFunctionsByCodeSigningConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListFunctionsByCodeSigningConfigRequest
 *   CodeSigningConfigArn: "STRING_VALUE", // required
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new ListFunctionsByCodeSigningConfigCommand(input);
 * const response = await client.send(command);
 * // { // ListFunctionsByCodeSigningConfigResponse
 * //   NextMarker: "STRING_VALUE",
 * //   FunctionArns: [ // FunctionArnList
 * //     "STRING_VALUE",
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListFunctionsByCodeSigningConfigCommandInput - {@link ListFunctionsByCodeSigningConfigCommandInput}
 * @returns {@link ListFunctionsByCodeSigningConfigCommandOutput}
 * @see {@link ListFunctionsByCodeSigningConfigCommandInput} for command's `input` shape.
 * @see {@link ListFunctionsByCodeSigningConfigCommandOutput} for command's `response` shape.
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
export declare class ListFunctionsByCodeSigningConfigCommand extends ListFunctionsByCodeSigningConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListFunctionsByCodeSigningConfigRequest;
            output: ListFunctionsByCodeSigningConfigResponse;
        };
        sdk: {
            input: ListFunctionsByCodeSigningConfigCommandInput;
            output: ListFunctionsByCodeSigningConfigCommandOutput;
        };
    };
}
