import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetLayerVersionInternalRequest, GetLayerVersionInternalResponse } from "../models/models_0";
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
 * The input for {@link GetLayerVersionInternalCommand}.
 */
export interface GetLayerVersionInternalCommandInput extends GetLayerVersionInternalRequest {
}
/**
 * @public
 *
 * The output of {@link GetLayerVersionInternalCommand}.
 */
export interface GetLayerVersionInternalCommandOutput extends GetLayerVersionInternalResponse, __MetadataBearer {
}
declare const GetLayerVersionInternalCommand_base: {
    new (input: GetLayerVersionInternalCommandInput): import("@smithy/smithy-client").CommandImpl<GetLayerVersionInternalCommandInput, GetLayerVersionInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetLayerVersionInternalCommandInput): import("@smithy/smithy-client").CommandImpl<GetLayerVersionInternalCommandInput, GetLayerVersionInternalCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetLayerVersionInternalCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetLayerVersionInternalCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetLayerVersionInternalRequest
 *   LayerVersionArn: "STRING_VALUE", // required
 *   AllowOnlyPresignedUrl: true || false,
 *   FallbackLayerUriToSign: "STRING_VALUE",
 * };
 * const command = new GetLayerVersionInternalCommand(input);
 * const response = await client.send(command);
 * // { // GetLayerVersionInternalResponse
 * //   Content: { // LayerVersionInternalContentOutput
 * //     CodeSigningProfileVersionArn: "STRING_VALUE",
 * //     CodeSigningJobArn: "STRING_VALUE",
 * //     InternalFormatLocation: "STRING_VALUE",
 * //     UncompressedCodeSize: Number("long"),
 * //     CodeSize: Number("long"),
 * //     CodeUri: "STRING_VALUE",
 * //     S3CodeVersionId: "STRING_VALUE",
 * //     CodeSignatureExpirationTime: Number("long"),
 * //     CodeSignatureStatus: "STRING_VALUE",
 * //     CodeSignatureRevocationData: new Uint8Array(),
 * //   },
 * //   LayerVersionArn: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param GetLayerVersionInternalCommandInput - {@link GetLayerVersionInternalCommandInput}
 * @returns {@link GetLayerVersionInternalCommandOutput}
 * @see {@link GetLayerVersionInternalCommandInput} for command's `input` shape.
 * @see {@link GetLayerVersionInternalCommandOutput} for command's `response` shape.
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
export declare class GetLayerVersionInternalCommand extends GetLayerVersionInternalCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetLayerVersionInternalRequest;
            output: GetLayerVersionInternalResponse;
        };
        sdk: {
            input: GetLayerVersionInternalCommandInput;
            output: GetLayerVersionInternalCommandOutput;
        };
    };
}
