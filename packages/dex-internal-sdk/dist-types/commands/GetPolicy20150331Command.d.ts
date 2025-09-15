import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetPolicyRequest, GetPolicyResponse } from "../models/models_0";
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
 * The input for {@link GetPolicy20150331Command}.
 */
export interface GetPolicy20150331CommandInput extends GetPolicyRequest {
}
/**
 * @public
 *
 * The output of {@link GetPolicy20150331Command}.
 */
export interface GetPolicy20150331CommandOutput extends GetPolicyResponse, __MetadataBearer {
}
declare const GetPolicy20150331Command_base: {
    new (input: GetPolicy20150331CommandInput): import("@smithy/smithy-client").CommandImpl<GetPolicy20150331CommandInput, GetPolicy20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetPolicy20150331CommandInput): import("@smithy/smithy-client").CommandImpl<GetPolicy20150331CommandInput, GetPolicy20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetPolicy20150331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetPolicy20150331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetPolicyRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE",
 * };
 * const command = new GetPolicy20150331Command(input);
 * const response = await client.send(command);
 * // { // GetPolicyResponse
 * //   Policy: "STRING_VALUE",
 * //   RevisionId: "STRING_VALUE",
 * //   PublicAccessAllowed: true || false,
 * // };
 *
 * ```
 *
 * @param GetPolicy20150331CommandInput - {@link GetPolicy20150331CommandInput}
 * @returns {@link GetPolicy20150331CommandOutput}
 * @see {@link GetPolicy20150331CommandInput} for command's `input` shape.
 * @see {@link GetPolicy20150331CommandOutput} for command's `response` shape.
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
export declare class GetPolicy20150331Command extends GetPolicy20150331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetPolicyRequest;
            output: GetPolicyResponse;
        };
        sdk: {
            input: GetPolicy20150331CommandInput;
            output: GetPolicy20150331CommandOutput;
        };
    };
}
