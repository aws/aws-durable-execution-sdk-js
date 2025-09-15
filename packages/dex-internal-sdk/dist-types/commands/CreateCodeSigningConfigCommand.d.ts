import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { CreateCodeSigningConfigRequest, CreateCodeSigningConfigResponse } from "../models/models_0";
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
 * The input for {@link CreateCodeSigningConfigCommand}.
 */
export interface CreateCodeSigningConfigCommandInput extends CreateCodeSigningConfigRequest {
}
/**
 * @public
 *
 * The output of {@link CreateCodeSigningConfigCommand}.
 */
export interface CreateCodeSigningConfigCommandOutput extends CreateCodeSigningConfigResponse, __MetadataBearer {
}
declare const CreateCodeSigningConfigCommand_base: {
    new (input: CreateCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<CreateCodeSigningConfigCommandInput, CreateCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: CreateCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<CreateCodeSigningConfigCommandInput, CreateCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, CreateCodeSigningConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, CreateCodeSigningConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // CreateCodeSigningConfigRequest
 *   Description: "STRING_VALUE",
 *   AllowedPublishers: { // AllowedPublishers
 *     SigningProfileVersionArns: [ // SigningProfileVersionArns // required
 *       "STRING_VALUE",
 *     ],
 *   },
 *   CodeSigningPolicies: { // CodeSigningPolicies
 *     UntrustedArtifactOnDeployment: "Warn" || "Enforce", // required
 *   },
 *   Tags: { // Tags
 *     "<keys>": "STRING_VALUE",
 *   },
 * };
 * const command = new CreateCodeSigningConfigCommand(input);
 * const response = await client.send(command);
 * // { // CreateCodeSigningConfigResponse
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
 * @param CreateCodeSigningConfigCommandInput - {@link CreateCodeSigningConfigCommandInput}
 * @returns {@link CreateCodeSigningConfigCommandOutput}
 * @see {@link CreateCodeSigningConfigCommandInput} for command's `input` shape.
 * @see {@link CreateCodeSigningConfigCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ServiceException} (server fault)
 *
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class CreateCodeSigningConfigCommand extends CreateCodeSigningConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: CreateCodeSigningConfigRequest;
            output: CreateCodeSigningConfigResponse;
        };
        sdk: {
            input: CreateCodeSigningConfigCommandInput;
            output: CreateCodeSigningConfigCommandOutput;
        };
    };
}
