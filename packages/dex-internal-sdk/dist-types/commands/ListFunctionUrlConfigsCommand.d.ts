import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListFunctionUrlConfigsRequest, ListFunctionUrlConfigsResponse } from "../models/models_1";
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
 * The input for {@link ListFunctionUrlConfigsCommand}.
 */
export interface ListFunctionUrlConfigsCommandInput extends ListFunctionUrlConfigsRequest {
}
/**
 * @public
 *
 * The output of {@link ListFunctionUrlConfigsCommand}.
 */
export interface ListFunctionUrlConfigsCommandOutput extends ListFunctionUrlConfigsResponse, __MetadataBearer {
}
declare const ListFunctionUrlConfigsCommand_base: {
    new (input: ListFunctionUrlConfigsCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionUrlConfigsCommandInput, ListFunctionUrlConfigsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListFunctionUrlConfigsCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionUrlConfigsCommandInput, ListFunctionUrlConfigsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListFunctionUrlConfigsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListFunctionUrlConfigsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListFunctionUrlConfigsRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new ListFunctionUrlConfigsCommand(input);
 * const response = await client.send(command);
 * // { // ListFunctionUrlConfigsResponse
 * //   FunctionUrlConfigs: [ // FunctionUrlConfigList // required
 * //     { // FunctionUrlConfig
 * //       FunctionUrl: "STRING_VALUE", // required
 * //       FunctionArn: "STRING_VALUE", // required
 * //       CreationTime: "STRING_VALUE", // required
 * //       LastModifiedTime: "STRING_VALUE", // required
 * //       Cors: { // Cors
 * //         AllowCredentials: true || false,
 * //         AllowHeaders: [ // HeadersList
 * //           "STRING_VALUE",
 * //         ],
 * //         AllowMethods: [ // AllowMethodsList
 * //           "STRING_VALUE",
 * //         ],
 * //         AllowOrigins: [ // AllowOriginsList
 * //           "STRING_VALUE",
 * //         ],
 * //         ExposeHeaders: [
 * //           "STRING_VALUE",
 * //         ],
 * //         MaxAge: Number("int"),
 * //       },
 * //       AuthType: "NONE" || "AWS_IAM", // required
 * //       InvokeMode: "BUFFERED" || "RESPONSE_STREAM",
 * //     },
 * //   ],
 * //   NextMarker: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param ListFunctionUrlConfigsCommandInput - {@link ListFunctionUrlConfigsCommandInput}
 * @returns {@link ListFunctionUrlConfigsCommandOutput}
 * @see {@link ListFunctionUrlConfigsCommandInput} for command's `input` shape.
 * @see {@link ListFunctionUrlConfigsCommandOutput} for command's `response` shape.
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
export declare class ListFunctionUrlConfigsCommand extends ListFunctionUrlConfigsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListFunctionUrlConfigsRequest;
            output: ListFunctionUrlConfigsResponse;
        };
        sdk: {
            input: ListFunctionUrlConfigsCommandInput;
            output: ListFunctionUrlConfigsCommandOutput;
        };
    };
}
