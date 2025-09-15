import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { PutPublicAccessBlockConfigRequest, PutPublicAccessBlockConfigResponse } from "../models/models_1";
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
 * The input for {@link PutPublicAccessBlockConfigCommand}.
 */
export interface PutPublicAccessBlockConfigCommandInput extends PutPublicAccessBlockConfigRequest {
}
/**
 * @public
 *
 * The output of {@link PutPublicAccessBlockConfigCommand}.
 */
export interface PutPublicAccessBlockConfigCommandOutput extends PutPublicAccessBlockConfigResponse, __MetadataBearer {
}
declare const PutPublicAccessBlockConfigCommand_base: {
    new (input: PutPublicAccessBlockConfigCommandInput): import("@smithy/smithy-client").CommandImpl<PutPublicAccessBlockConfigCommandInput, PutPublicAccessBlockConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: PutPublicAccessBlockConfigCommandInput): import("@smithy/smithy-client").CommandImpl<PutPublicAccessBlockConfigCommandInput, PutPublicAccessBlockConfigCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, PutPublicAccessBlockConfigCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, PutPublicAccessBlockConfigCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // PutPublicAccessBlockConfigRequest
 *   ResourceArn: "STRING_VALUE", // required
 *   PublicAccessBlockConfig: { // PublicAccessBlockConfig
 *     BlockPublicPolicy: true || false,
 *     RestrictPublicResource: true || false,
 *   },
 * };
 * const command = new PutPublicAccessBlockConfigCommand(input);
 * const response = await client.send(command);
 * // { // PutPublicAccessBlockConfigResponse
 * //   PublicAccessBlockConfig: { // PublicAccessBlockConfig
 * //     BlockPublicPolicy: true || false,
 * //     RestrictPublicResource: true || false,
 * //   },
 * // };
 *
 * ```
 *
 * @param PutPublicAccessBlockConfigCommandInput - {@link PutPublicAccessBlockConfigCommandInput}
 * @returns {@link PutPublicAccessBlockConfigCommandOutput}
 * @see {@link PutPublicAccessBlockConfigCommandInput} for command's `input` shape.
 * @see {@link PutPublicAccessBlockConfigCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
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
export declare class PutPublicAccessBlockConfigCommand extends PutPublicAccessBlockConfigCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: PutPublicAccessBlockConfigRequest;
            output: PutPublicAccessBlockConfigResponse;
        };
        sdk: {
            input: PutPublicAccessBlockConfigCommandInput;
            output: PutPublicAccessBlockConfigCommandOutput;
        };
    };
}
