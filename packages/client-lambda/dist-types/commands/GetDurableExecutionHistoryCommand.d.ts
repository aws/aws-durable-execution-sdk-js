import { Command as $Command } from "@smithy/smithy-client";
import { MetadataBearer as __MetadataBearer } from "@smithy/types";
import {
  LambdaClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from "../LambdaClient";
import {
  GetDurableExecutionHistoryRequest,
  GetDurableExecutionHistoryResponse,
} from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 *
 * The input for {@link GetDurableExecutionHistoryCommand}.
 */
export interface GetDurableExecutionHistoryCommandInput
  extends GetDurableExecutionHistoryRequest {}
/**
 * @public
 *
 * The output of {@link GetDurableExecutionHistoryCommand}.
 */
export interface GetDurableExecutionHistoryCommandOutput
  extends GetDurableExecutionHistoryResponse,
    __MetadataBearer {}
declare const GetDurableExecutionHistoryCommand_base: {
  new (
    input: GetDurableExecutionHistoryCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    GetDurableExecutionHistoryCommandInput,
    GetDurableExecutionHistoryCommandOutput,
    LambdaClientResolvedConfig,
    ServiceInputTypes,
    ServiceOutputTypes
  >;
  new (
    input: GetDurableExecutionHistoryCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    GetDurableExecutionHistoryCommandInput,
    GetDurableExecutionHistoryCommandOutput,
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
 * import { LambdaClient, GetDurableExecutionHistoryCommand } from "@aws-sdk/client-lambda"; // ES Modules import
 * // const { LambdaClient, GetDurableExecutionHistoryCommand } = require("@aws-sdk/client-lambda"); // CommonJS import
 * // import type { LambdaClientConfig } from "@aws-sdk/client-lambda";
 * const config = {}; // type is LambdaClientConfig
 * const client = new LambdaClient(config);
 * const input = { // GetDurableExecutionHistoryRequest
 *   DurableExecutionArn: "STRING_VALUE", // required
 *   IncludeExecutionData: true || false,
 *   MaxItems: Number("int"),
 *   Marker: "STRING_VALUE",
 *   ReverseOrder: true || false,
 * };
 * const command = new GetDurableExecutionHistoryCommand(input);
 * const response = await client.send(command);
 * // { // GetDurableExecutionHistoryResponse
 * //   Events: [ // Events
 * //     { // Event
 * //       EventType: "ExecutionStarted" || "ExecutionSucceeded" || "ExecutionFailed" || "ExecutionTimedOut" || "ExecutionStopped" || "ContextStarted" || "ContextSucceeded" || "ContextFailed" || "WaitStarted" || "WaitSucceeded" || "WaitCancelled" || "StepStarted" || "StepSucceeded" || "StepFailed" || "ChainedInvokePending" || "ChainedInvokeStarted" || "ChainedInvokeSucceeded" || "ChainedInvokeFailed" || "ChainedInvokeTimedOut" || "ChainedInvokeCancelled" || "CallbackStarted" || "CallbackSucceeded" || "CallbackFailed" || "CallbackTimedOut" || "InvocationCompleted",
 * //       SubType: "STRING_VALUE",
 * //       EventId: Number("int"),
 * //       Id: "STRING_VALUE",
 * //       Name: "STRING_VALUE",
 * //       EventTimestamp: new Date("TIMESTAMP"),
 * //       ParentId: "STRING_VALUE",
 * //       ExecutionStartedDetails: { // ExecutionStartedDetails
 * //         Input: { // EventInput
 * //           Payload: "STRING_VALUE",
 * //           Truncated: true || false,
 * //         },
 * //         ExecutionTimeout: Number("int"),
 * //       },
 * //       ExecutionSucceededDetails: { // ExecutionSucceededDetails
 * //         Result: { // EventResult
 * //           Payload: "STRING_VALUE",
 * //           Truncated: true || false,
 * //         },
 * //       },
 * //       ExecutionFailedDetails: { // ExecutionFailedDetails
 * //         Error: { // EventError
 * //           Payload: { // ErrorObject
 * //             ErrorMessage: "STRING_VALUE",
 * //             ErrorType: "STRING_VALUE",
 * //             ErrorData: "STRING_VALUE",
 * //             StackTrace: [ // StackTraceEntries
 * //               "STRING_VALUE",
 * //             ],
 * //           },
 * //           Truncated: true || false,
 * //         },
 * //       },
 * //       ExecutionTimedOutDetails: { // ExecutionTimedOutDetails
 * //         Error: {
 * //           Payload: {
 * //             ErrorMessage: "STRING_VALUE",
 * //             ErrorType: "STRING_VALUE",
 * //             ErrorData: "STRING_VALUE",
 * //             StackTrace: [
 * //               "STRING_VALUE",
 * //             ],
 * //           },
 * //           Truncated: true || false,
 * //         },
 * //       },
 * //       ExecutionStoppedDetails: { // ExecutionStoppedDetails
 * //         Error: {
 * //           Payload: {
 * //             ErrorMessage: "STRING_VALUE",
 * //             ErrorType: "STRING_VALUE",
 * //             ErrorData: "STRING_VALUE",
 * //             StackTrace: [
 * //               "STRING_VALUE",
 * //             ],
 * //           },
 * //           Truncated: true || false,
 * //         },
 * //       },
 * //       ContextStartedDetails: {},
 * //       ContextSucceededDetails: { // ContextSucceededDetails
 * //         Result: {
 * //           Payload: "STRING_VALUE",
 * //           Truncated: true || false,
 * //         },
 * //       },
 * //       ContextFailedDetails: { // ContextFailedDetails
 * //         Error: {
 * //           Payload: {
 * //             ErrorMessage: "STRING_VALUE",
 * //             ErrorType: "STRING_VALUE",
 * //             ErrorData: "STRING_VALUE",
 * //             StackTrace: [
 * //               "STRING_VALUE",
 * //             ],
 * //           },
 * //           Truncated: true || false,
 * //         },
 * //       },
 * //       WaitStartedDetails: { // WaitStartedDetails
 * //         Duration: Number("int"),
 * //         ScheduledEndTimestamp: new Date("TIMESTAMP"),
 * //       },
 * //       WaitSucceededDetails: { // WaitSucceededDetails
 * //         Duration: Number("int"),
 * //       },
 * //       WaitCancelledDetails: { // WaitCancelledDetails
 * //         Error: {
 * //           Payload: {
 * //             ErrorMessage: "STRING_VALUE",
 * //             ErrorType: "STRING_VALUE",
 * //             ErrorData: "STRING_VALUE",
 * //             StackTrace: [
 * //               "STRING_VALUE",
 * //             ],
 * //           },
 * //           Truncated: true || false,
 * //         },
 * //       },
 * //       StepStartedDetails: {},
 * //       StepSucceededDetails: { // StepSucceededDetails
 * //         Result: {
 * //           Payload: "STRING_VALUE",
 * //           Truncated: true || false,
 * //         },
 * //         RetryDetails: { // RetryDetails
 * //           CurrentAttempt: Number("int"),
 * //           NextAttemptDelaySeconds: Number("int"),
 * //         },
 * //       },
 * //       StepFailedDetails: { // StepFailedDetails
 * //         Error: "<EventError>",
 * //         RetryDetails: {
 * //           CurrentAttempt: Number("int"),
 * //           NextAttemptDelaySeconds: Number("int"),
 * //         },
 * //       },
 * //       ChainedInvokePendingDetails: { // ChainedInvokePendingDetails
 * //         Input: {
 * //           Payload: "STRING_VALUE",
 * //           Truncated: true || false,
 * //         },
 * //         FunctionName: "STRING_VALUE",
 * //         Timeout: Number("int"),
 * //       },
 * //       ChainedInvokeStartedDetails: { // ChainedInvokeStartedDetails
 * //         DurableExecutionArn: "STRING_VALUE",
 * //       },
 * //       ChainedInvokeSucceededDetails: { // ChainedInvokeSucceededDetails
 * //         Result: {
 * //           Payload: "STRING_VALUE",
 * //           Truncated: true || false,
 * //         },
 * //       },
 * //       ChainedInvokeFailedDetails: { // ChainedInvokeFailedDetails
 * //         Error: "<EventError>",
 * //       },
 * //       ChainedInvokeTimedOutDetails: { // ChainedInvokeTimedOutDetails
 * //         Error: "<EventError>",
 * //       },
 * //       ChainedInvokeStoppedDetails: { // ChainedInvokeStoppedDetails
 * //         Error: "<EventError>",
 * //       },
 * //       CallbackStartedDetails: { // CallbackStartedDetails
 * //         CallbackId: "STRING_VALUE",
 * //         HeartbeatTimeout: Number("int"),
 * //         Timeout: Number("int"),
 * //       },
 * //       CallbackSucceededDetails: { // CallbackSucceededDetails
 * //         Result: {
 * //           Payload: "STRING_VALUE",
 * //           Truncated: true || false,
 * //         },
 * //       },
 * //       CallbackFailedDetails: { // CallbackFailedDetails
 * //         Error: "<EventError>",
 * //       },
 * //       CallbackTimedOutDetails: { // CallbackTimedOutDetails
 * //         Error: "<EventError>",
 * //       },
 * //       InvocationCompletedDetails: { // InvocationCompletedDetails
 * //         StartTimestamp: new Date("TIMESTAMP"), // required
 * //         EndTimestamp: new Date("TIMESTAMP"), // required
 * //         RequestId: "STRING_VALUE",
 * //         Error: "<EventError>",
 * //       },
 * //     },
 * //   ],
 * //   NextMarker: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param GetDurableExecutionHistoryCommandInput - {@link GetDurableExecutionHistoryCommandInput}
 * @returns {@link GetDurableExecutionHistoryCommandOutput}
 * @see {@link GetDurableExecutionHistoryCommandInput} for command's `input` shape.
 * @see {@link GetDurableExecutionHistoryCommandOutput} for command's `response` shape.
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
export declare class GetDurableExecutionHistoryCommand extends GetDurableExecutionHistoryCommand_base {
  /** @internal type navigation helper, not in runtime. */
  protected static __types: {
    api: {
      input: GetDurableExecutionHistoryRequest;
      output: GetDurableExecutionHistoryResponse;
    };
    sdk: {
      input: GetDurableExecutionHistoryCommandInput;
      output: GetDurableExecutionHistoryCommandOutput;
    };
  };
}
