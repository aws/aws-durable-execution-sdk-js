import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetVersionSandboxSpecRequest, GetVersionSandboxSpecResponse } from "../models/models_0";
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
 * The input for {@link GetVersionSandboxSpecCommand}.
 */
export interface GetVersionSandboxSpecCommandInput extends GetVersionSandboxSpecRequest {
}
/**
 * @public
 *
 * The output of {@link GetVersionSandboxSpecCommand}.
 */
export interface GetVersionSandboxSpecCommandOutput extends GetVersionSandboxSpecResponse, __MetadataBearer {
}
declare const GetVersionSandboxSpecCommand_base: {
    new (input: GetVersionSandboxSpecCommandInput): import("@smithy/smithy-client").CommandImpl<GetVersionSandboxSpecCommandInput, GetVersionSandboxSpecCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetVersionSandboxSpecCommandInput): import("@smithy/smithy-client").CommandImpl<GetVersionSandboxSpecCommandInput, GetVersionSandboxSpecCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetVersionSandboxSpecCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetVersionSandboxSpecCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetVersionSandboxSpecRequest
 *   FunctionName: "STRING_VALUE", // required
 * };
 * const command = new GetVersionSandboxSpecCommand(input);
 * const response = await client.send(command);
 * // { // GetVersionSandboxSpecResponse
 * //   SandboxSpec: new Uint8Array(),
 * //   PendingConfigSandboxSpec: new Uint8Array(),
 * // };
 *
 * ```
 *
 * @param GetVersionSandboxSpecCommandInput - {@link GetVersionSandboxSpecCommandInput}
 * @returns {@link GetVersionSandboxSpecCommandOutput}
 * @see {@link GetVersionSandboxSpecCommandInput} for command's `input` shape.
 * @see {@link GetVersionSandboxSpecCommandOutput} for command's `response` shape.
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
export declare class GetVersionSandboxSpecCommand extends GetVersionSandboxSpecCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetVersionSandboxSpecRequest;
            output: GetVersionSandboxSpecResponse;
        };
        sdk: {
            input: GetVersionSandboxSpecCommandInput;
            output: GetVersionSandboxSpecCommandOutput;
        };
    };
}
