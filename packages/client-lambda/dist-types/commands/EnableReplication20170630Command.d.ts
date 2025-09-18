import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { AddPermissionResponse, EnableReplicationRequest20170630 } from "../models/models_0";
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
 * The input for {@link EnableReplication20170630Command}.
 */
export interface EnableReplication20170630CommandInput extends EnableReplicationRequest20170630 {
}
/**
 * @public
 *
 * The output of {@link EnableReplication20170630Command}.
 */
export interface EnableReplication20170630CommandOutput extends AddPermissionResponse, __MetadataBearer {
}
declare const EnableReplication20170630Command_base: {
    new (input: EnableReplication20170630CommandInput): import("@smithy/smithy-client").CommandImpl<EnableReplication20170630CommandInput, EnableReplication20170630CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: EnableReplication20170630CommandInput): import("@smithy/smithy-client").CommandImpl<EnableReplication20170630CommandInput, EnableReplication20170630CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, EnableReplication20170630Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, EnableReplication20170630Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // EnableReplicationRequest20170630
 *   FunctionName: "STRING_VALUE", // required
 *   Qualifier: "STRING_VALUE", // required
 *   RevisionId: "STRING_VALUE",
 * };
 * const command = new EnableReplication20170630Command(input);
 * const response = await client.send(command);
 * // { // AddPermissionResponse
 * //   Statement: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param EnableReplication20170630CommandInput - {@link EnableReplication20170630CommandInput}
 * @returns {@link EnableReplication20170630CommandOutput}
 * @see {@link EnableReplication20170630CommandInput} for command's `input` shape.
 * @see {@link EnableReplication20170630CommandOutput} for command's `response` shape.
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
export declare class EnableReplication20170630Command extends EnableReplication20170630Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: EnableReplicationRequest20170630;
            output: AddPermissionResponse;
        };
        sdk: {
            input: EnableReplication20170630CommandInput;
            output: EnableReplication20170630CommandOutput;
        };
    };
}
