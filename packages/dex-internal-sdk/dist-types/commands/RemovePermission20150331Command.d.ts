import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { RemovePermissionRequest } from "../models/models_1";
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
 * The input for {@link RemovePermission20150331Command}.
 */
export interface RemovePermission20150331CommandInput extends RemovePermissionRequest {
}
/**
 * @public
 *
 * The output of {@link RemovePermission20150331Command}.
 */
export interface RemovePermission20150331CommandOutput extends __MetadataBearer {
}
declare const RemovePermission20150331Command_base: {
    new (input: RemovePermission20150331CommandInput): import("@smithy/smithy-client").CommandImpl<RemovePermission20150331CommandInput, RemovePermission20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: RemovePermission20150331CommandInput): import("@smithy/smithy-client").CommandImpl<RemovePermission20150331CommandInput, RemovePermission20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, RemovePermission20150331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, RemovePermission20150331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // RemovePermissionRequest
 *   FunctionName: "STRING_VALUE", // required
 *   StatementId: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 *   RevisionId: "STRING_VALUE",
 * };
 * const command = new RemovePermission20150331Command(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param RemovePermission20150331CommandInput - {@link RemovePermission20150331CommandInput}
 * @returns {@link RemovePermission20150331CommandOutput}
 * @see {@link RemovePermission20150331CommandInput} for command's `input` shape.
 * @see {@link RemovePermission20150331CommandOutput} for command's `response` shape.
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
export declare class RemovePermission20150331Command extends RemovePermission20150331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: RemovePermissionRequest;
            output: {};
        };
        sdk: {
            input: RemovePermission20150331CommandInput;
            output: RemovePermission20150331CommandOutput;
        };
    };
}
