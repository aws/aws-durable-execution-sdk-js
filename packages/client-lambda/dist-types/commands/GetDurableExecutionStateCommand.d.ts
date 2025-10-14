import { Command as $Command } from "@smithy/smithy-client";
import { MetadataBearer as __MetadataBearer } from "@smithy/types";
import {
  LambdaClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from "../LambdaClient";
import {
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
} from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 *
 * The input for {@link GetDurableExecutionStateCommand}.
 */
export interface GetDurableExecutionStateCommandInput
  extends GetDurableExecutionStateRequest {}
/**
 * @public
 *
 * The output of {@link GetDurableExecutionStateCommand}.
 */
export interface GetDurableExecutionStateCommandOutput
  extends GetDurableExecutionStateResponse,
    __MetadataBearer {}
declare const GetDurableExecutionStateCommand_base: {
  new (
    input: GetDurableExecutionStateCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    GetDurableExecutionStateCommandInput,
    GetDurableExecutionStateCommandOutput,
    LambdaClientResolvedConfig,
    ServiceInputTypes,
    ServiceOutputTypes
  >;
  new (
    input: GetDurableExecutionStateCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    GetDurableExecutionStateCommandInput,
    GetDurableExecutionStateCommandOutput,
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
 * import { LambdaClient, GetDurableExecutionStateCommand } from "@aws-sdk/client-lambda"; // ES Modules import
 * // const { LambdaClient, GetDurableExecutionStateCommand } = require("@aws-sdk/client-lambda"); // CommonJS import
 * // import type { LambdaClientConfig } from "@aws-sdk/client-lambda";
 * const config = {}; // type is LambdaClientConfig
 * const client = new LambdaClient(config);
 * const input = { // GetDurableExecutionStateRequest
 *   DurableExecutionArn: "STRING_VALUE", // required
 *   CheckpointToken: "STRING_VALUE", // required
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new GetDurableExecutionStateCommand(input);
 * const response = await client.send(command);
 * // { // GetDurableExecutionStateResponse
 * //   Operations: [ // Operations // required
 * //     { // Operation
 * //       Id: "STRING_VALUE", // required
 * //       ParentId: "STRING_VALUE",
 * //       Name: "STRING_VALUE",
 * //       Type: "EXECUTION" || "CONTEXT" || "STEP" || "WAIT" || "CALLBACK" || "CHAINED_INVOKE", // required
 * //       SubType: "STRING_VALUE",
 * //       StartTimestamp: new Date("TIMESTAMP"), // required
 * //       EndTimestamp: new Date("TIMESTAMP"),
 * //       Status: "STARTED" || "PENDING" || "READY" || "SUCCEEDED" || "FAILED" || "CANCELLED" || "TIMED_OUT" || "STOPPED", // required
 * //       ExecutionDetails: { // ExecutionDetails
 * //         InputPayload: "STRING_VALUE",
 * //       },
 * //       ContextDetails: { // ContextDetails
 * //         ReplayChildren: true || false,
 * //         Result: "STRING_VALUE",
 * //         Error: { // ErrorObject
 * //           ErrorMessage: "STRING_VALUE",
 * //           ErrorType: "STRING_VALUE",
 * //           ErrorData: "STRING_VALUE",
 * //           StackTrace: [ // StackTraceEntries
 * //             "STRING_VALUE",
 * //           ],
 * //         },
 * //       },
 * //       StepDetails: { // StepDetails
 * //         Attempt: Number("int"),
 * //         NextAttemptTimestamp: new Date("TIMESTAMP"),
 * //         Result: "STRING_VALUE",
 * //         Error: {
 * //           ErrorMessage: "STRING_VALUE",
 * //           ErrorType: "STRING_VALUE",
 * //           ErrorData: "STRING_VALUE",
 * //           StackTrace: [
 * //             "STRING_VALUE",
 * //           ],
 * //         },
 * //       },
 * //       WaitDetails: { // WaitDetails
 * //         ScheduledEndTimestamp: new Date("TIMESTAMP"),
 * //       },
 * //       CallbackDetails: { // CallbackDetails
 * //         CallbackId: "STRING_VALUE",
 * //         Result: "STRING_VALUE",
 * //         Error: {
 * //           ErrorMessage: "STRING_VALUE",
 * //           ErrorType: "STRING_VALUE",
 * //           ErrorData: "STRING_VALUE",
 * //           StackTrace: [
 * //             "STRING_VALUE",
 * //           ],
 * //         },
 * //       },
 * //       ChainedInvokeDetails: { // ChainedInvokeDetails
 * //         Result: "STRING_VALUE",
 * //         Error: {
 * //           ErrorMessage: "STRING_VALUE",
 * //           ErrorType: "STRING_VALUE",
 * //           ErrorData: "STRING_VALUE",
 * //           StackTrace: [
 * //             "STRING_VALUE",
 * //           ],
 * //         },
 * //       },
 * //     },
 * //   ],
 * //   NextMarker: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param GetDurableExecutionStateCommandInput - {@link GetDurableExecutionStateCommandInput}
 * @returns {@link GetDurableExecutionStateCommandOutput}
 * @see {@link GetDurableExecutionStateCommandInput} for command's `input` shape.
 * @see {@link GetDurableExecutionStateCommandOutput} for command's `response` shape.
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
export declare class GetDurableExecutionStateCommand extends GetDurableExecutionStateCommand_base {
  /** @internal type navigation helper, not in runtime. */
  protected static __types: {
    api: {
      input: GetDurableExecutionStateRequest;
      output: GetDurableExecutionStateResponse;
    };
    sdk: {
      input: GetDurableExecutionStateCommandInput;
      output: GetDurableExecutionStateCommandOutput;
    };
  };
}
