import { Command as $Command } from "@smithy/smithy-client";
import { MetadataBearer as __MetadataBearer } from "@smithy/types";
import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListDurableExecutionsRequest, ListDurableExecutionsResponse } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 *
 * The input for {@link ListDurableExecutionsCommand}.
 */
export interface ListDurableExecutionsCommandInput extends ListDurableExecutionsRequest {
}
/**
 * @public
 *
 * The output of {@link ListDurableExecutionsCommand}.
 */
export interface ListDurableExecutionsCommandOutput extends ListDurableExecutionsResponse, __MetadataBearer {
}
declare const ListDurableExecutionsCommand_base: {
    new (input: ListDurableExecutionsCommandInput): import("@smithy/smithy-client").CommandImpl<ListDurableExecutionsCommandInput, ListDurableExecutionsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (...[input]: [] | [ListDurableExecutionsCommandInput]): import("@smithy/smithy-client").CommandImpl<ListDurableExecutionsCommandInput, ListDurableExecutionsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListDurableExecutionsCommand } from "@aws-sdk/client-lambda"; // ES Modules import
 * // const { LambdaClient, ListDurableExecutionsCommand } = require("@aws-sdk/client-lambda"); // CommonJS import
 * // import type { LambdaClientConfig } from "@aws-sdk/client-lambda";
 * const config = {}; // type is LambdaClientConfig
 * const client = new LambdaClient(config);
 * const input = { // ListDurableExecutionsRequest
 *   FunctionName: "STRING_VALUE",
 *   FunctionVersion: "STRING_VALUE",
 *   DurableExecutionName: "STRING_VALUE",
 *   StatusFilter: [ // ExecutionStatusList
 *     "RUNNING" || "SUCCEEDED" || "FAILED" || "TIMED_OUT" || "STOPPED",
 *   ],
 *   TimeAfter: new Date("TIMESTAMP"),
 *   TimeBefore: new Date("TIMESTAMP"),
 *   ReverseOrder: true || false,
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new ListDurableExecutionsCommand(input);
 * const response = await client.send(command);
 * // { // ListDurableExecutionsResponse
 * //   DurableExecutions: [ // DurableExecutions
 * //     { // Execution
 * //       DurableExecutionArn: "STRING_VALUE",
 * //       DurableExecutionName: "STRING_VALUE",
 * //       FunctionArn: "STRING_VALUE",
 * //       Status: "RUNNING" || "SUCCEEDED" || "FAILED" || "TIMED_OUT" || "STOPPED",
 * //       StartDate: new Date("TIMESTAMP"),
 * //       StopDate: new Date("TIMESTAMP"),
 * //     },
 * //   ],
 * //   NextMarker: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param ListDurableExecutionsCommandInput - {@link ListDurableExecutionsCommandInput}
 * @returns {@link ListDurableExecutionsCommandOutput}
 * @see {@link ListDurableExecutionsCommandInput} for command's `input` shape.
 * @see {@link ListDurableExecutionsCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *  <p>One of the parameters in the request is not valid.</p>
 *
 * @throws {@link ServiceException} (server fault)
 *  <p>The Lambda service encountered an internal error.</p>
 *
 * @throws {@link TooManyRequestsException} (client fault)
 *  <p>The request throughput limit was exceeded. For more information, see <a href="https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html#api-requests">Lambda quotas</a>.</p>
 *
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class ListDurableExecutionsCommand extends ListDurableExecutionsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListDurableExecutionsRequest;
            output: ListDurableExecutionsResponse;
        };
        sdk: {
            input: ListDurableExecutionsCommandInput;
            output: ListDurableExecutionsCommandOutput;
        };
    };
}
