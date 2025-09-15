import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListFunctionEventInvokeConfigsRequest, ListFunctionEventInvokeConfigsResponse } from "../models/models_1";
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
 * The input for {@link ListFunctionEventInvokeConfigsCommand}.
 */
export interface ListFunctionEventInvokeConfigsCommandInput extends ListFunctionEventInvokeConfigsRequest {
}
/**
 * @public
 *
 * The output of {@link ListFunctionEventInvokeConfigsCommand}.
 */
export interface ListFunctionEventInvokeConfigsCommandOutput extends ListFunctionEventInvokeConfigsResponse, __MetadataBearer {
}
declare const ListFunctionEventInvokeConfigsCommand_base: {
    new (input: ListFunctionEventInvokeConfigsCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionEventInvokeConfigsCommandInput, ListFunctionEventInvokeConfigsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ListFunctionEventInvokeConfigsCommandInput): import("@smithy/smithy-client").CommandImpl<ListFunctionEventInvokeConfigsCommandInput, ListFunctionEventInvokeConfigsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListFunctionEventInvokeConfigsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListFunctionEventInvokeConfigsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListFunctionEventInvokeConfigsRequest
 *   FunctionName: "STRING_VALUE", // required
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new ListFunctionEventInvokeConfigsCommand(input);
 * const response = await client.send(command);
 * // { // ListFunctionEventInvokeConfigsResponse
 * //   FunctionEventInvokeConfigs: [ // FunctionEventInvokeConfigList
 * //     { // FunctionEventInvokeConfig
 * //       LastModified: new Date("TIMESTAMP"),
 * //       FunctionArn: "STRING_VALUE",
 * //       MaximumRetryAttempts: Number("int"),
 * //       MaximumEventAgeInSeconds: Number("int"),
 * //       DestinationConfig: { // DestinationConfig
 * //         OnSuccess: { // OnSuccess
 * //           Destination: "STRING_VALUE",
 * //         },
 * //         OnFailure: { // OnFailure
 * //           Destination: "STRING_VALUE",
 * //         },
 * //       },
 * //     },
 * //   ],
 * //   NextMarker: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param ListFunctionEventInvokeConfigsCommandInput - {@link ListFunctionEventInvokeConfigsCommandInput}
 * @returns {@link ListFunctionEventInvokeConfigsCommandOutput}
 * @see {@link ListFunctionEventInvokeConfigsCommandInput} for command's `input` shape.
 * @see {@link ListFunctionEventInvokeConfigsCommandOutput} for command's `response` shape.
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
export declare class ListFunctionEventInvokeConfigsCommand extends ListFunctionEventInvokeConfigsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListFunctionEventInvokeConfigsRequest;
            output: ListFunctionEventInvokeConfigsResponse;
        };
        sdk: {
            input: ListFunctionEventInvokeConfigsCommandInput;
            output: ListFunctionEventInvokeConfigsCommandOutput;
        };
    };
}
