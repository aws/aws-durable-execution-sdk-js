import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { CheckpointDurableExecutionRequest, CheckpointDurableExecutionResponse } from "../models/models_0";
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
 * The input for {@link CheckpointDurableExecutionCommand}.
 */
export interface CheckpointDurableExecutionCommandInput extends CheckpointDurableExecutionRequest {
}
/**
 * @public
 *
 * The output of {@link CheckpointDurableExecutionCommand}.
 */
export interface CheckpointDurableExecutionCommandOutput extends CheckpointDurableExecutionResponse, __MetadataBearer {
}
declare const CheckpointDurableExecutionCommand_base: {
    new (input: CheckpointDurableExecutionCommandInput): import("@smithy/smithy-client").CommandImpl<CheckpointDurableExecutionCommandInput, CheckpointDurableExecutionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: CheckpointDurableExecutionCommandInput): import("@smithy/smithy-client").CommandImpl<CheckpointDurableExecutionCommandInput, CheckpointDurableExecutionCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, CheckpointDurableExecutionCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, CheckpointDurableExecutionCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // CheckpointDurableExecutionRequest
 *   DurableExecutionArn: "STRING_VALUE", // required
 *   CheckpointToken: "STRING_VALUE", // required
 *   Updates: [ // OperationUpdates
 *     { // OperationUpdate
 *       Id: "STRING_VALUE",
 *       ParentId: "STRING_VALUE",
 *       Name: "STRING_VALUE",
 *       Type: "EXECUTION" || "CONTEXT" || "STEP" || "WAIT" || "CALLBACK" || "INVOKE",
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
 *       InvokeOptions: { // InvokeOptions
 *         FunctionName: "STRING_VALUE",
 *         FunctionQualifier: "STRING_VALUE",
 *         DurableExecutionName: "STRING_VALUE",
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
 * //         Type: "EXECUTION" || "CONTEXT" || "STEP" || "WAIT" || "CALLBACK" || "INVOKE",
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
 * //         InvokeDetails: { // InvokeDetails
 * //           DurableExecutionArn: "STRING_VALUE",
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
