import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { UpdateCodeSigningConfigRequest, UpdateCodeSigningConfigResponse } from "../models/models_1";
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
 * The input for {@link UpdateCodeSigningConfigCommand}.
 */
export interface UpdateCodeSigningConfigCommandInput extends UpdateCodeSigningConfigRequest {
}
/**
 * @public
 *
 * The output of {@link UpdateCodeSigningConfigCommand}.
 */
export interface UpdateCodeSigningConfigCommandOutput extends UpdateCodeSigningConfigResponse, __MetadataBearer {
}
declare const UpdateCodeSigningConfigCommand_base: {
    new (input: UpdateCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateCodeSigningConfigCommandInput, UpdateCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: UpdateCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<UpdateCodeSigningConfigCommandInput, UpdateCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, UpdateCodeSigningConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, UpdateCodeSigningConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // UpdateCodeSigningConfigRequest
 *   Description: "STRING_VALUE",
 *   CodeSigningConfigArn: "STRING_VALUE", // required
 *   AllowedPublishers: { // AllowedPublishers
 *     SigningProfileVersionArns: [ // SigningProfileVersionArns // required
 *       "STRING_VALUE",
 *     ],
 *   },
 *   CodeSigningPolicies: { // CodeSigningPolicies
 *     UntrustedArtifactOnDeployment: "Warn" || "Enforce", // required
 *   },
 * };
 * const command = new UpdateCodeSigningConfigCommand(input);
 * const response = await client.send(command);
 * // { // UpdateCodeSigningConfigResponse
 * //   CodeSigningConfig: { // CodeSigningConfig
 * //     CodeSigningConfigId: "STRING_VALUE", // required
 * //     CodeSigningConfigArn: "STRING_VALUE", // required
 * //     Description: "STRING_VALUE",
 * //     AllowedPublishers: { // AllowedPublishers
 * //       SigningProfileVersionArns: [ // SigningProfileVersionArns // required
 * //         "STRING_VALUE",
 * //       ],
 * //     },
 * //     CodeSigningPolicies: { // CodeSigningPolicies
 * //       UntrustedArtifactOnDeployment: "Warn" || "Enforce", // required
 * //     },
 * //     LastModified: "STRING_VALUE", // required
 * //   },
 * // };
 *
 * ```
 *
 * @param UpdateCodeSigningConfigCommandInput - {@link UpdateCodeSigningConfigCommandInput}
 * @returns {@link UpdateCodeSigningConfigCommandOutput}
 * @see {@link UpdateCodeSigningConfigCommandInput} for command's `input` shape.
 * @see {@link UpdateCodeSigningConfigCommandOutput} for command's `response` shape.
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
export declare class UpdateCodeSigningConfigCommand extends UpdateCodeSigningConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: UpdateCodeSigningConfigRequest;
            output: UpdateCodeSigningConfigResponse;
        };
        sdk: {
            input: UpdateCodeSigningConfigCommandInput;
            output: UpdateCodeSigningConfigCommandOutput;
        };
    };
}
