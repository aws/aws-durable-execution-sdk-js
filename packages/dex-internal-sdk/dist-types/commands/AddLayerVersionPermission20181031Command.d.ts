import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { AddLayerVersionPermissionRequest20181031, AddLayerVersionPermissionResponse20181031 } from "../models/models_0";
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
 * The input for {@link AddLayerVersionPermission20181031Command}.
 */
export interface AddLayerVersionPermission20181031CommandInput extends AddLayerVersionPermissionRequest20181031 {
}
/**
 * @public
 *
 * The output of {@link AddLayerVersionPermission20181031Command}.
 */
export interface AddLayerVersionPermission20181031CommandOutput extends AddLayerVersionPermissionResponse20181031, __MetadataBearer {
}
declare const AddLayerVersionPermission20181031Command_base: {
    new (input: AddLayerVersionPermission20181031CommandInput): import("@smithy/smithy-client").CommandImpl<AddLayerVersionPermission20181031CommandInput, AddLayerVersionPermission20181031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: AddLayerVersionPermission20181031CommandInput): import("@smithy/smithy-client").CommandImpl<AddLayerVersionPermission20181031CommandInput, AddLayerVersionPermission20181031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, AddLayerVersionPermission20181031Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, AddLayerVersionPermission20181031Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // AddLayerVersionPermissionRequest20181031
 *   LayerName: "STRING_VALUE", // required
 *   VersionNumber: Number("long"), // required
 *   StatementId: "STRING_VALUE", // required
 *   Action: "STRING_VALUE", // required
 *   Principal: "STRING_VALUE", // required
 *   OrganizationId: "STRING_VALUE",
 *   RevisionId: "STRING_VALUE",
 * };
 * const command = new AddLayerVersionPermission20181031Command(input);
 * const response = await client.send(command);
 * // { // AddLayerVersionPermissionResponse20181031
 * //   Statement: "STRING_VALUE",
 * //   RevisionId: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param AddLayerVersionPermission20181031CommandInput - {@link AddLayerVersionPermission20181031CommandInput}
 * @returns {@link AddLayerVersionPermission20181031CommandOutput}
 * @see {@link AddLayerVersionPermission20181031CommandInput} for command's `input` shape.
 * @see {@link AddLayerVersionPermission20181031CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link PolicyLengthExceededException} (client fault)
 *
 * @throws {@link PreconditionFailedException} (client fault)
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
export declare class AddLayerVersionPermission20181031Command extends AddLayerVersionPermission20181031Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: AddLayerVersionPermissionRequest20181031;
            output: AddLayerVersionPermissionResponse20181031;
        };
        sdk: {
            input: AddLayerVersionPermission20181031CommandInput;
            output: AddLayerVersionPermission20181031CommandOutput;
        };
    };
}
