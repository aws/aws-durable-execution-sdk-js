import {
  LambdaClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from "../LambdaClient";
import {
  GetDurableExecutionStateRequest,
  GetDurableExecutionStateResponse,
} from "../models/models_0";
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
 * import { LambdaClient, GetDurableExecutionStateCommand } from "@amzn/dex-internal-sdk"; // ES Modules import
 * // const { LambdaClient, GetDurableExecutionStateCommand } = require("@amzn/dex-internal-sdk"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetDurableExecutionStateRequest
 *   CheckpointToken: "STRING_VALUE", // required
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new GetDurableExecutionStateCommand(input);
 * const response = await client.send(command);
 * // { // GetDurableExecutionStateResponse
 * //   Operations: [ // Operations
 * //     { // Operation
 * //       Id: "STRING_VALUE",
 * //       ParentId: "STRING_VALUE",
 * //       Name: "STRING_VALUE",
 * //       Type: "EXECUTION" || "CONTEXT" || "STEP" || "WAIT" || "CALLBACK" || "INVOKE",
 * //       SubType: "STRING_VALUE",
 * //       StartTimestamp: new Date("TIMESTAMP"),
 * //       EndTimestamp: new Date("TIMESTAMP"),
 * //       Status: "STARTED" || "PENDING" || "READY" || "SUCCEEDED" || "FAILED" || "CANCELLED" || "TIMED_OUT" || "STOPPED",
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
 * //         ScheduledTimestamp: new Date("TIMESTAMP"),
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
 * //       InvokeDetails: { // InvokeDetails
 * //         DurableExecutionArn: "STRING_VALUE",
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
 *
 * @throws {@link TooManyRequestsException} (client fault)
 *
 * @throws {@link ServiceException} (server fault)
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
