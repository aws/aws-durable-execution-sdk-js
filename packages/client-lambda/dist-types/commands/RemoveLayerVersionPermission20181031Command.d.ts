import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { RemoveLayerVersionPermissionRequest20181031 } from "../models/models_1";
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
 * The input for {@link RemoveLayerVersionPermission20181031Command}.
 */
export interface RemoveLayerVersionPermission20181031CommandInput extends RemoveLayerVersionPermissionRequest20181031 {
}
/**
 * @public
 *
 * The output of {@link RemoveLayerVersionPermission20181031Command}.
 */
export interface RemoveLayerVersionPermission20181031CommandOutput extends __MetadataBearer {
}
declare const RemoveLayerVersionPermission20181031Command_base: {
    new (input: RemoveLayerVersionPermission20181031CommandInput): import("@smithy/smithy-client").CommandImpl<RemoveLayerVersionPermission20181031CommandInput, RemoveLayerVersionPermission20181031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: RemoveLayerVersionPermission20181031CommandInput): import("@smithy/smithy-client").CommandImpl<RemoveLayerVersionPermission20181031CommandInput, RemoveLayerVersionPermission20181031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, RemoveLayerVersionPermission20181031Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, RemoveLayerVersionPermission20181031Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // RemoveLayerVersionPermissionRequest20181031
 *   LayerName: "STRING_VALUE", // required
 *   VersionNumber: Number("long"), // required
 *   StatementId: "STRING_VALUE", // required
 *   RevisionId: "STRING_VALUE",
 * };
 * const command = new RemoveLayerVersionPermission20181031Command(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param RemoveLayerVersionPermission20181031CommandInput - {@link RemoveLayerVersionPermission20181031CommandInput}
 * @returns {@link RemoveLayerVersionPermission20181031CommandOutput}
 * @see {@link RemoveLayerVersionPermission20181031CommandInput} for command's `input` shape.
 * @see {@link RemoveLayerVersionPermission20181031CommandOutput} for command's `response` shape.
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
export declare class RemoveLayerVersionPermission20181031Command extends RemoveLayerVersionPermission20181031Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: RemoveLayerVersionPermissionRequest20181031;
            output: {};
        };
        sdk: {
            input: RemoveLayerVersionPermission20181031CommandInput;
            output: RemoveLayerVersionPermission20181031CommandOutput;
        };
    };
}
