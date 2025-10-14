import { Command as $Command } from "@smithy/smithy-client";
import { MetadataBearer as __MetadataBearer } from "@smithy/types";
import {
  LambdaClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from "../LambdaClient";
import {
  StopDurableExecutionRequest,
  StopDurableExecutionResponse,
} from "../models/models_1";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 *
 * The input for {@link StopDurableExecutionCommand}.
 */
export interface StopDurableExecutionCommandInput
  extends StopDurableExecutionRequest {}
/**
 * @public
 *
 * The output of {@link StopDurableExecutionCommand}.
 */
export interface StopDurableExecutionCommandOutput
  extends StopDurableExecutionResponse,
    __MetadataBearer {}
declare const StopDurableExecutionCommand_base: {
  new (
    input: StopDurableExecutionCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    StopDurableExecutionCommandInput,
    StopDurableExecutionCommandOutput,
    LambdaClientResolvedConfig,
    ServiceInputTypes,
    ServiceOutputTypes
  >;
  new (
    input: StopDurableExecutionCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    StopDurableExecutionCommandInput,
    StopDurableExecutionCommandOutput,
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
 * import { LambdaClient, StopDurableExecutionCommand } from "@aws-sdk/client-lambda"; // ES Modules import
 * // const { LambdaClient, StopDurableExecutionCommand } = require("@aws-sdk/client-lambda"); // CommonJS import
 * // import type { LambdaClientConfig } from "@aws-sdk/client-lambda";
 * const config = {}; // type is LambdaClientConfig
 * const client = new LambdaClient(config);
 * const input = { // StopDurableExecutionRequest
 *   DurableExecutionArn: "STRING_VALUE", // required
 *   Error: { // ErrorObject
 *     ErrorMessage: "STRING_VALUE",
 *     ErrorType: "STRING_VALUE",
 *     ErrorData: "STRING_VALUE",
 *     StackTrace: [ // StackTraceEntries
 *       "STRING_VALUE",
 *     ],
 *   },
 * };
 * const command = new StopDurableExecutionCommand(input);
 * const response = await client.send(command);
 * // { // StopDurableExecutionResponse
 * //   StopTimestamp: new Date("TIMESTAMP"), // required
 * // };
 *
 * ```
 *
 * @param StopDurableExecutionCommandInput - {@link StopDurableExecutionCommandInput}
 * @returns {@link StopDurableExecutionCommandOutput}
 * @see {@link StopDurableExecutionCommandInput} for command's `input` shape.
 * @see {@link StopDurableExecutionCommandOutput} for command's `response` shape.
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
export declare class StopDurableExecutionCommand extends StopDurableExecutionCommand_base {
  /** @internal type navigation helper, not in runtime. */
  protected static __types: {
    api: {
      input: StopDurableExecutionRequest;
      output: StopDurableExecutionResponse;
    };
    sdk: {
      input: StopDurableExecutionCommandInput;
      output: StopDurableExecutionCommandOutput;
    };
  };
}
