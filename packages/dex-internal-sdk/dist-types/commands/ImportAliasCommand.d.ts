import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ImportAliasRequest, ImportAliasResponse } from "../models/models_1";
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
 * The input for {@link ImportAliasCommand}.
 */
export interface ImportAliasCommandInput extends ImportAliasRequest {
}
/**
 * @public
 *
 * The output of {@link ImportAliasCommand}.
 */
export interface ImportAliasCommandOutput extends ImportAliasResponse, __MetadataBearer {
}
declare const ImportAliasCommand_base: {
    new (input: ImportAliasCommandInput): import("@smithy/smithy-client").CommandImpl<ImportAliasCommandInput, ImportAliasCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ImportAliasCommandInput): import("@smithy/smithy-client").CommandImpl<ImportAliasCommandInput, ImportAliasCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ImportAliasCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ImportAliasCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ImportAliasRequest
 *   AliasArn: "STRING_VALUE", // required
 *   MigrationAlias: { // MigrationAlias
 *     AliasArn: "STRING_VALUE",
 *     AliasName: "STRING_VALUE",
 *     FunctionVersion: "STRING_VALUE",
 *     ModifiedDateInEpochMillis: Number("long"),
 *     Policy: "STRING_VALUE",
 *     Description: "STRING_VALUE",
 *     AdditionalVersionWeights: { // AdditionalVersionWeights
 *       "<keys>": Number("double"),
 *     },
 *     TargetAdditionalVersionWeights: {
 *       "<keys>": Number("double"),
 *     },
 *     HashOfConsistentFields: "STRING_VALUE",
 *     PublicPolicyAttached: true || false,
 *   },
 * };
 * const command = new ImportAliasCommand(input);
 * const response = await client.send(command);
 * // { // ImportAliasResponse
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
 * @param ImportAliasCommandInput - {@link ImportAliasCommandInput}
 * @returns {@link ImportAliasCommandOutput}
 * @see {@link ImportAliasCommandInput} for command's `input` shape.
 * @see {@link ImportAliasCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
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
export declare class ImportAliasCommand extends ImportAliasCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ImportAliasRequest;
            output: ImportAliasResponse;
        };
        sdk: {
            input: ImportAliasCommandInput;
            output: ImportAliasCommandOutput;
        };
    };
}
