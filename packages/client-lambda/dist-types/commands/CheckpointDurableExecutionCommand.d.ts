import { Command as $Command } from "@smithy/smithy-client";
import { MetadataBearer as __MetadataBearer } from "@smithy/types";
import {
  LambdaClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from "../LambdaClient";
import {
  CheckpointDurableExecutionRequest,
  CheckpointDurableExecutionResponse,
} from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 *
 * The input for {@link CheckpointDurableExecutionCommand}.
 */
export interface CheckpointDurableExecutionCommandInput
  extends CheckpointDurableExecutionRequest {}
/**
 * @public
 *
 * The output of {@link CheckpointDurableExecutionCommand}.
 */
export interface CheckpointDurableExecutionCommandOutput
  extends CheckpointDurableExecutionResponse,
    __MetadataBearer {}
declare const CheckpointDurableExecutionCommand_base: {
  new (
    input: CheckpointDurableExecutionCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    CheckpointDurableExecutionCommandInput,
    CheckpointDurableExecutionCommandOutput,
    LambdaClientResolvedConfig,
    ServiceInputTypes,
    ServiceOutputTypes
  >;
  new (
    input: CheckpointDurableExecutionCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    CheckpointDurableExecutionCommandInput,
    CheckpointDurableExecutionCommandOutput,
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
 * import { LambdaClient, CheckpointDurableExecutionCommand } from "@aws-sdk/client-lambda"; // ES Modules import
 * // const { LambdaClient, CheckpointDurableExecutionCommand } = require("@aws-sdk/client-lambda"); // CommonJS import
 * // import type { LambdaClientConfig } from "@aws-sdk/client-lambda";
 * const config = {}; // type is LambdaClientConfig
 * const client = new LambdaClient(config);
 * const input = { // CheckpointDurableExecutionRequest
 *   DurableExecutionArn: "STRING_VALUE", // required
 *   CheckpointToken: "STRING_VALUE", // required
 *   Updates: [ // OperationUpdates
 *     { // OperationUpdate
 *       Id: "STRING_VALUE",
 *       ParentId: "STRING_VALUE",
 *       Name: "STRING_VALUE",
 *       Type: "EXECUTION" || "CONTEXT" || "STEP" || "WAIT" || "CALLBACK" || "CHAINED_INVOKE",
 *       SubType: "STRING_VALUE",
 *       Action: "START" || "SUCCEED" || "FAIL" || "RETRY" || "CANCEL",
 *       Payload: "STRING_VALUE",
 *       Error: { // ErrorObject
 *         ErrorMessage: "STRING_VALUE",
 *         ErrorType: "STRING_VALUE",
 *         ErrorData: "STRING_VALUE",
 *         StackTrace: [ // StackTraceEntries
 *           "STRING_VALUE",
 *         ],
 *       },
 *       ContextOptions: { // ContextOptions
 *         ReplayChildren: true || false,
 *       },
 *       StepOptions: { // StepOptions
 *         NextAttemptDelaySeconds: Number("int"),
 *       },
 *       WaitOptions: { // WaitOptions
 *         WaitSeconds: Number("int"),
 *       },
 *       CallbackOptions: { // CallbackOptions
 *         TimeoutSeconds: Number("int"),
 *         HeartbeatTimeoutSeconds: Number("int"),
 *       },
 *       ChainedInvokeOptions: { // ChainedInvokeOptions
 *         FunctionName: "STRING_VALUE",
 *         TimeoutSeconds: Number("int"),
 *       },
 *     },
 *   ],
 *   ClientToken: "STRING_VALUE",
 * };
 * const command = new CheckpointDurableExecutionCommand(input);
 * const response = await client.send(command);
 * // { // CheckpointDurableExecutionResponse
 * //   CheckpointToken: "STRING_VALUE",
 * //   NewExecutionState: { // CheckpointUpdatedExecutionState
 * //     Operations: [ // Operations
 * //       { // Operation
 * //         Id: "STRING_VALUE",
 * //         ParentId: "STRING_VALUE",
 * //         Name: "STRING_VALUE",
 * //         Type: "EXECUTION" || "CONTEXT" || "STEP" || "WAIT" || "CALLBACK" || "CHAINED_INVOKE",
 * //         SubType: "STRING_VALUE",
 * //         StartTimestamp: new Date("TIMESTAMP"),
 * //         EndTimestamp: new Date("TIMESTAMP"),
 * //         Status: "STARTED" || "PENDING" || "READY" || "SUCCEEDED" || "FAILED" || "CANCELLED" || "TIMED_OUT" || "STOPPED",
 * //         ExecutionDetails: { // ExecutionDetails
 * //           InputPayload: "STRING_VALUE",
 * //         },
 * //         ContextDetails: { // ContextDetails
 * //           ReplayChildren: true || false,
 * //           Result: "STRING_VALUE",
 * //           Error: { // ErrorObject
 * //             ErrorMessage: "STRING_VALUE",
 * //             ErrorType: "STRING_VALUE",
 * //             ErrorData: "STRING_VALUE",
 * //             StackTrace: [ // StackTraceEntries
 * //               "STRING_VALUE",
 * //             ],
 * //           },
 * //         },
 * //         StepDetails: { // StepDetails
 * //           Attempt: Number("int"),
 * //           NextAttemptTimestamp: new Date("TIMESTAMP"),
 * //           Result: "STRING_VALUE",
 * //           Error: {
 * //             ErrorMessage: "STRING_VALUE",
 * //             ErrorType: "STRING_VALUE",
 * //             ErrorData: "STRING_VALUE",
 * //             StackTrace: [
 * //               "STRING_VALUE",
 * //             ],
 * //           },
 * //         },
 * //         WaitDetails: { // WaitDetails
 * //           ScheduledTimestamp: new Date("TIMESTAMP"),
 * //         },
 * //         CallbackDetails: { // CallbackDetails
 * //           CallbackId: "STRING_VALUE",
 * //           Result: "STRING_VALUE",
 * //           Error: {
 * //             ErrorMessage: "STRING_VALUE",
 * //             ErrorType: "STRING_VALUE",
 * //             ErrorData: "STRING_VALUE",
 * //             StackTrace: [
 * //               "STRING_VALUE",
 * //             ],
 * //           },
 * //         },
 * //         ChainedInvokeDetails: { // ChainedInvokeDetails
 * //           Result: "STRING_VALUE",
 * //           Error: {
 * //             ErrorMessage: "STRING_VALUE",
 * //             ErrorType: "STRING_VALUE",
 * //             ErrorData: "STRING_VALUE",
 * //             StackTrace: [
 * //               "STRING_VALUE",
 * //             ],
 * //           },
 * //         },
 * //       },
 * //     ],
 * //     NextMarker: "STRING_VALUE",
 * //   },
 * // };
 *
 * ```
 *
 * @param CheckpointDurableExecutionCommandInput - {@link CheckpointDurableExecutionCommandInput}
 * @returns {@link CheckpointDurableExecutionCommandOutput}
 * @see {@link CheckpointDurableExecutionCommandInput} for command's `input` shape.
 * @see {@link CheckpointDurableExecutionCommandOutput} for command's `response` shape.
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
export declare class CheckpointDurableExecutionCommand extends CheckpointDurableExecutionCommand_base {
  /** @internal type navigation helper, not in runtime. */
  protected static __types: {
    api: {
      input: CheckpointDurableExecutionRequest;
      output: CheckpointDurableExecutionResponse;
    };
    sdk: {
      input: CheckpointDurableExecutionCommandInput;
      output: CheckpointDurableExecutionCommandOutput;
    };
  };
}
