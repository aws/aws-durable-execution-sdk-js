import { Command as $Command } from "@smithy/smithy-client";
import { MetadataBearer as __MetadataBearer } from "@smithy/types";
import {
  LambdaClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from "../LambdaClient";
import {
  GetDurableExecutionRequest,
  GetDurableExecutionResponse,
} from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 *
 * The input for {@link GetDurableExecutionCommand}.
 */
export interface GetDurableExecutionCommandInput
  extends GetDurableExecutionRequest {}
/**
 * @public
 *
 * The output of {@link GetDurableExecutionCommand}.
 */
export interface GetDurableExecutionCommandOutput
  extends GetDurableExecutionResponse,
    __MetadataBearer {}
declare const GetDurableExecutionCommand_base: {
  new (
    input: GetDurableExecutionCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    GetDurableExecutionCommandInput,
    GetDurableExecutionCommandOutput,
    LambdaClientResolvedConfig,
    ServiceInputTypes,
    ServiceOutputTypes
  >;
  new (
    input: GetDurableExecutionCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    GetDurableExecutionCommandInput,
    GetDurableExecutionCommandOutput,
    LambdaClientResolvedConfig,
    ServiceInputTypes,
    ServiceOutputTypes
  >;
  getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetDurableExecutionCommand } from "@aws-sdk/client-lambda"; // ES Modules import
 * // const { LambdaClient, GetDurableExecutionCommand } = require("@aws-sdk/client-lambda"); // CommonJS import
 * // import type { LambdaClientConfig } from "@aws-sdk/client-lambda";
 * const config = {}; // type is LambdaClientConfig
 * const client = new LambdaClient(config);
 * const input = { // GetDurableExecutionRequest
 *   DurableExecutionArn: "STRING_VALUE", // required
 * };
 * const command = new GetDurableExecutionCommand(input);
 * const response = await client.send(command);
 * // { // GetDurableExecutionResponse
 * //   DurableExecutionArn: "STRING_VALUE",
 * //   DurableExecutionName: "STRING_VALUE",
 * //   FunctionArn: "STRING_VALUE",
 * //   InputPayload: "STRING_VALUE",
 * //   Result: "STRING_VALUE",
 * //   Error: { // ErrorObject
 * //     ErrorMessage: "STRING_VALUE",
 * //     ErrorType: "STRING_VALUE",
 * //     ErrorData: "STRING_VALUE",
 * //     StackTrace: [ // StackTraceEntries
 * //       "STRING_VALUE",
 * //     ],
 * //   },
 * //   StartTimestamp: new Date("TIMESTAMP"),
 * //   Status: "RUNNING" || "SUCCEEDED" || "FAILED" || "TIMED_OUT" || "STOPPED",
 * //   EndTimestamp: new Date("TIMESTAMP"),
 * //   Version: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param GetDurableExecutionCommandInput - {@link GetDurableExecutionCommandInput}
 * @returns {@link GetDurableExecutionCommandOutput}
 * @see {@link GetDurableExecutionCommandInput} for command's `input` shape.
 * @see {@link GetDurableExecutionCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *  <p>One of the parameters in the request is not valid.</p>
 *
 * @throws {@link ResourceNotFoundException} (client fault)
 *  <p>The resource specified in the request does not exist.</p>
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
export declare class GetDurableExecutionCommand extends GetDurableExecutionCommand_base {
  /** @internal type navigation helper, not in runtime. */
  protected static __types: {
    api: {
      input: GetDurableExecutionRequest;
      output: GetDurableExecutionResponse;
    };
    sdk: {
      input: GetDurableExecutionCommandInput;
      output: GetDurableExecutionCommandOutput;
    };
  };
}
