import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { AddPermissionRequest, AddPermissionResponse } from "../models/models_0";
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
 * The input for {@link AddPermission20150331v2Command}.
 */
export interface AddPermission20150331v2CommandInput extends AddPermissionRequest {
}
/**
 * @public
 *
 * The output of {@link AddPermission20150331v2Command}.
 */
export interface AddPermission20150331v2CommandOutput extends AddPermissionResponse, __MetadataBearer {
}
declare const AddPermission20150331v2Command_base: {
    new (input: AddPermission20150331v2CommandInput): import("@smithy/smithy-client").CommandImpl<AddPermission20150331v2CommandInput, AddPermission20150331v2CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: AddPermission20150331v2CommandInput): import("@smithy/smithy-client").CommandImpl<AddPermission20150331v2CommandInput, AddPermission20150331v2CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, AddPermission20150331v2Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, AddPermission20150331v2Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // AddPermissionRequest
 *   FunctionName: "STRING_VALUE", // required
 *   StatementId: "STRING_VALUE", // required
 *   Action: "STRING_VALUE", // required
 *   Principal: "STRING_VALUE", // required
 *   SourceArn: "STRING_VALUE",
 *   FunctionUrlAuthType: "NONE" || "AWS_IAM",
 *   InvokedViaFunctionUrl: true || false,
 *   SourceAccount: "STRING_VALUE",
 *   EventSourceToken: "STRING_VALUE",
 *   Qualifier: "STRING_VALUE",
 *   RevisionId: "STRING_VALUE",
 *   PrincipalOrgID: "STRING_VALUE",
 * };
 * const command = new AddPermission20150331v2Command(input);
 * const response = await client.send(command);
 * // { // AddPermissionResponse
 * //   Statement: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param AddPermission20150331v2CommandInput - {@link AddPermission20150331v2CommandInput}
 * @returns {@link AddPermission20150331v2CommandOutput}
 * @see {@link AddPermission20150331v2CommandInput} for command's `input` shape.
 * @see {@link AddPermission20150331v2CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link PolicyLengthExceededException} (client fault)
 *
 * @throws {@link PreconditionFailedException} (client fault)
 *
 * @throws {@link PublicPolicyException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
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
export declare class AddPermission20150331v2Command extends AddPermission20150331v2Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: AddPermissionRequest;
            output: AddPermissionResponse;
        };
        sdk: {
            input: AddPermission20150331v2CommandInput;
            output: AddPermission20150331v2CommandOutput;
        };
    };
}
