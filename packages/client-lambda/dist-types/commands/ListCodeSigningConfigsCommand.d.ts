import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListCodeSigningConfigsRequest, ListCodeSigningConfigsResponse } from "../models/models_1";
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
 * The input for {@link ListCodeSigningConfigsCommand}.
 */
export interface ListCodeSigningConfigsCommandInput extends ListCodeSigningConfigsRequest {
}
/**
 * @public
 *
 * The output of {@link ListCodeSigningConfigsCommand}.
 */
export interface ListCodeSigningConfigsCommandOutput extends ListCodeSigningConfigsResponse, __MetadataBearer {
}
declare const ListCodeSigningConfigsCommand_base: {
    new (input: ListCodeSigningConfigsCommandInput): import("@smithy/smithy-client").CommandImpl<ListCodeSigningConfigsCommandInput, ListCodeSigningConfigsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (...[input]: [] | [ListCodeSigningConfigsCommandInput]): import("@smithy/smithy-client").CommandImpl<ListCodeSigningConfigsCommandInput, ListCodeSigningConfigsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListCodeSigningConfigsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListCodeSigningConfigsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListCodeSigningConfigsRequest
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new ListCodeSigningConfigsCommand(input);
 * const response = await client.send(command);
 * // { // ListCodeSigningConfigsResponse
 * //   NextMarker: "STRING_VALUE",
 * //   CodeSigningConfigs: [ // CodeSigningConfigList
 * //     { // CodeSigningConfig
 * //       CodeSigningConfigId: "STRING_VALUE", // required
 * //       CodeSigningConfigArn: "STRING_VALUE", // required
 * //       Description: "STRING_VALUE",
 * //       AllowedPublishers: { // AllowedPublishers
 * //         SigningProfileVersionArns: [ // SigningProfileVersionArns // required
 * //           "STRING_VALUE",
 * //         ],
 * //       },
 * //       CodeSigningPolicies: { // CodeSigningPolicies
 * //         UntrustedArtifactOnDeployment: "Warn" || "Enforce", // required
 * //       },
 * //       LastModified: "STRING_VALUE", // required
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListCodeSigningConfigsCommandInput - {@link ListCodeSigningConfigsCommandInput}
 * @returns {@link ListCodeSigningConfigsCommandOutput}
 * @see {@link ListCodeSigningConfigsCommandInput} for command's `input` shape.
 * @see {@link ListCodeSigningConfigsCommandOutput} for command's `response` shape.
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
export declare class ListCodeSigningConfigsCommand extends ListCodeSigningConfigsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListCodeSigningConfigsRequest;
            output: ListCodeSigningConfigsResponse;
        };
        sdk: {
            input: ListCodeSigningConfigsCommandInput;
            output: ListCodeSigningConfigsCommandOutput;
        };
    };
}
