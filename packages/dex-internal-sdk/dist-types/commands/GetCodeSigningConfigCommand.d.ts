import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetCodeSigningConfigRequest, GetCodeSigningConfigResponse } from "../models/models_0";
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
 * The input for {@link GetCodeSigningConfigCommand}.
 */
export interface GetCodeSigningConfigCommandInput extends GetCodeSigningConfigRequest {
}
/**
 * @public
 *
 * The output of {@link GetCodeSigningConfigCommand}.
 */
export interface GetCodeSigningConfigCommandOutput extends GetCodeSigningConfigResponse, __MetadataBearer {
}
declare const GetCodeSigningConfigCommand_base: {
    new (input: GetCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetCodeSigningConfigCommandInput, GetCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetCodeSigningConfigCommandInput): import("@smithy/smithy-client").CommandImpl<GetCodeSigningConfigCommandInput, GetCodeSigningConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetCodeSigningConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetCodeSigningConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetCodeSigningConfigRequest
 *   CodeSigningConfigArn: "STRING_VALUE", // required
 * };
 * const command = new GetCodeSigningConfigCommand(input);
 * const response = await client.send(command);
 * // { // GetCodeSigningConfigResponse
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
 * @param GetCodeSigningConfigCommandInput - {@link GetCodeSigningConfigCommandInput}
 * @returns {@link GetCodeSigningConfigCommandOutput}
 * @see {@link GetCodeSigningConfigCommandInput} for command's `input` shape.
 * @see {@link GetCodeSigningConfigCommandOutput} for command's `response` shape.
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
export declare class GetCodeSigningConfigCommand extends GetCodeSigningConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetCodeSigningConfigRequest;
            output: GetCodeSigningConfigResponse;
        };
        sdk: {
            input: GetCodeSigningConfigCommandInput;
            output: GetCodeSigningConfigCommandOutput;
        };
    };
}
