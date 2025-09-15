import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ImportFunctionUrlConfigsRequest, ImportFunctionUrlConfigsResponse } from "../models/models_1";
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
 * The input for {@link ImportFunctionUrlConfigsCommand}.
 */
export interface ImportFunctionUrlConfigsCommandInput extends ImportFunctionUrlConfigsRequest {
}
/**
 * @public
 *
 * The output of {@link ImportFunctionUrlConfigsCommand}.
 */
export interface ImportFunctionUrlConfigsCommandOutput extends ImportFunctionUrlConfigsResponse, __MetadataBearer {
}
declare const ImportFunctionUrlConfigsCommand_base: {
    new (input: ImportFunctionUrlConfigsCommandInput): import("@smithy/smithy-client").CommandImpl<ImportFunctionUrlConfigsCommandInput, ImportFunctionUrlConfigsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ImportFunctionUrlConfigsCommandInput): import("@smithy/smithy-client").CommandImpl<ImportFunctionUrlConfigsCommandInput, ImportFunctionUrlConfigsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ImportFunctionUrlConfigsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ImportFunctionUrlConfigsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ImportFunctionUrlConfigsRequest
 *   MigrationFunctionUrlConfig: { // MigrationFunctionUrlConfig
 *     FunctionUrl: "STRING_VALUE",
 *     FunctionArn: "STRING_VALUE",
 *     AuthType: "NONE" || "AWS_IAM",
 *     InvokeMode: "BUFFERED" || "RESPONSE_STREAM",
 *     LastModifiedTime: "STRING_VALUE",
 *     CreationTime: "STRING_VALUE",
 *     AccountId: "STRING_VALUE",
 *     Qualifier: "STRING_VALUE",
 *     UnqualifiedFunctionArn: "STRING_VALUE",
 *     FunctionName: "STRING_VALUE",
 *     UrlId: "STRING_VALUE",
 *     RevisionId: Number("int"),
 *     Cors: { // Cors
 *       AllowCredentials: true || false,
 *       AllowHeaders: [ // HeadersList
 *         "STRING_VALUE",
 *       ],
 *       AllowMethods: [ // AllowMethodsList
 *         "STRING_VALUE",
 *       ],
 *       AllowOrigins: [ // AllowOriginsList
 *         "STRING_VALUE",
 *       ],
 *       ExposeHeaders: [
 *         "STRING_VALUE",
 *       ],
 *       MaxAge: Number("int"),
 *     },
 *     Enabled: true || false,
 *     HashOfConsistentFields: "STRING_VALUE",
 *   },
 *   FunctionName: "STRING_VALUE", // required
 * };
 * const command = new ImportFunctionUrlConfigsCommand(input);
 * const response = await client.send(command);
 * // { // ImportFunctionUrlConfigsResponse
 * //   MigrationFunctionUrlConfig: { // MigrationFunctionUrlConfig
 * //     FunctionUrl: "STRING_VALUE",
 * //     FunctionArn: "STRING_VALUE",
 * //     AuthType: "NONE" || "AWS_IAM",
 * //     InvokeMode: "BUFFERED" || "RESPONSE_STREAM",
 * //     LastModifiedTime: "STRING_VALUE",
 * //     CreationTime: "STRING_VALUE",
 * //     AccountId: "STRING_VALUE",
 * //     Qualifier: "STRING_VALUE",
 * //     UnqualifiedFunctionArn: "STRING_VALUE",
 * //     FunctionName: "STRING_VALUE",
 * //     UrlId: "STRING_VALUE",
 * //     RevisionId: Number("int"),
 * //     Cors: { // Cors
 * //       AllowCredentials: true || false,
 * //       AllowHeaders: [ // HeadersList
 * //         "STRING_VALUE",
 * //       ],
 * //       AllowMethods: [ // AllowMethodsList
 * //         "STRING_VALUE",
 * //       ],
 * //       AllowOrigins: [ // AllowOriginsList
 * //         "STRING_VALUE",
 * //       ],
 * //       ExposeHeaders: [
 * //         "STRING_VALUE",
 * //       ],
 * //       MaxAge: Number("int"),
 * //     },
 * //     Enabled: true || false,
 * //     HashOfConsistentFields: "STRING_VALUE",
 * //   },
 * // };
 *
 * ```
 *
 * @param ImportFunctionUrlConfigsCommandInput - {@link ImportFunctionUrlConfigsCommandInput}
 * @returns {@link ImportFunctionUrlConfigsCommandOutput}
 * @see {@link ImportFunctionUrlConfigsCommandInput} for command's `input` shape.
 * @see {@link ImportFunctionUrlConfigsCommandOutput} for command's `response` shape.
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
export declare class ImportFunctionUrlConfigsCommand extends ImportFunctionUrlConfigsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ImportFunctionUrlConfigsRequest;
            output: ImportFunctionUrlConfigsResponse;
        };
        sdk: {
            input: ImportFunctionUrlConfigsCommandInput;
            output: ImportFunctionUrlConfigsCommandOutput;
        };
    };
}
