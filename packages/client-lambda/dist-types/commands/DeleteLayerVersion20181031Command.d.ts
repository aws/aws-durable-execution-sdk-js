import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { DeleteLayerVersionRequest20181031 } from "../models/models_0";
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
 * The input for {@link DeleteLayerVersion20181031Command}.
 */
export interface DeleteLayerVersion20181031CommandInput extends DeleteLayerVersionRequest20181031 {
}
/**
 * @public
 *
 * The output of {@link DeleteLayerVersion20181031Command}.
 */
export interface DeleteLayerVersion20181031CommandOutput extends __MetadataBearer {
}
declare const DeleteLayerVersion20181031Command_base: {
    new (input: DeleteLayerVersion20181031CommandInput): import("@smithy/smithy-client").CommandImpl<DeleteLayerVersion20181031CommandInput, DeleteLayerVersion20181031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: DeleteLayerVersion20181031CommandInput): import("@smithy/smithy-client").CommandImpl<DeleteLayerVersion20181031CommandInput, DeleteLayerVersion20181031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, DeleteLayerVersion20181031Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, DeleteLayerVersion20181031Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // DeleteLayerVersionRequest20181031
 *   LayerName: "STRING_VALUE", // required
 *   VersionNumber: Number("long"), // required
 * };
 * const command = new DeleteLayerVersion20181031Command(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param DeleteLayerVersion20181031CommandInput - {@link DeleteLayerVersion20181031CommandInput}
 * @returns {@link DeleteLayerVersion20181031CommandOutput}
 * @see {@link DeleteLayerVersion20181031CommandInput} for command's `input` shape.
 * @see {@link DeleteLayerVersion20181031CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
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
export declare class DeleteLayerVersion20181031Command extends DeleteLayerVersion20181031Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeleteLayerVersionRequest20181031;
            output: {};
        };
        sdk: {
            input: DeleteLayerVersion20181031CommandInput;
            output: DeleteLayerVersion20181031CommandOutput;
        };
    };
}
