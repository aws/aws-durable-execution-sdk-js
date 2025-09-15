import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ExportAliasRequest, ExportAliasResponse } from "../models/models_0";
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
 * The input for {@link ExportAliasCommand}.
 */
export interface ExportAliasCommandInput extends ExportAliasRequest {
}
/**
 * @public
 *
 * The output of {@link ExportAliasCommand}.
 */
export interface ExportAliasCommandOutput extends ExportAliasResponse, __MetadataBearer {
}
declare const ExportAliasCommand_base: {
    new (input: ExportAliasCommandInput): import("@smithy/smithy-client").CommandImpl<ExportAliasCommandInput, ExportAliasCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ExportAliasCommandInput): import("@smithy/smithy-client").CommandImpl<ExportAliasCommandInput, ExportAliasCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ExportAliasCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ExportAliasCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ExportAliasRequest
 *   AliasArn: "STRING_VALUE", // required
 * };
 * const command = new ExportAliasCommand(input);
 * const response = await client.send(command);
 * // { // ExportAliasResponse
 * //   MigrationAlias: { // MigrationAlias
 * //     AliasArn: "STRING_VALUE",
 * //     AliasName: "STRING_VALUE",
 * //     FunctionVersion: "STRING_VALUE",
 * //     ModifiedDateInEpochMillis: Number("long"),
 * //     Policy: "STRING_VALUE",
 * //     Description: "STRING_VALUE",
 * //     AdditionalVersionWeights: { // AdditionalVersionWeights
 * //       "<keys>": Number("double"),
 * //     },
 * //     TargetAdditionalVersionWeights: {
 * //       "<keys>": Number("double"),
 * //     },
 * //     HashOfConsistentFields: "STRING_VALUE",
 * //     PublicPolicyAttached: true || false,
 * //   },
 * // };
 *
 * ```
 *
 * @param ExportAliasCommandInput - {@link ExportAliasCommandInput}
 * @returns {@link ExportAliasCommandOutput}
 * @see {@link ExportAliasCommandInput} for command's `input` shape.
 * @see {@link ExportAliasCommandOutput} for command's `response` shape.
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
export declare class ExportAliasCommand extends ExportAliasCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ExportAliasRequest;
            output: ExportAliasResponse;
        };
        sdk: {
            input: ExportAliasCommandInput;
            output: ExportAliasCommandOutput;
        };
    };
}
