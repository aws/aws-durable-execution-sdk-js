import {
  LambdaClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from "../LambdaClient";
import {
  GetDurableExecutionRequest,
  GetDurableExecutionResponse,
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
 * import { LambdaClient, GetDurableExecutionCommand } from "@amzn/dex-internal-sdk"; // ES Modules import
 * // const { LambdaClient, GetDurableExecutionCommand } = require("@amzn/dex-internal-sdk"); // CommonJS import
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
 * //   StartDate: new Date("TIMESTAMP"),
 * //   Status: "RUNNING" || "SUCCEEDED" || "FAILED" || "TIMED_OUT" || "STOPPED",
 * //   StopDate: new Date("TIMESTAMP"),
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
 *
 * @throws {@link ResourceNotFoundException} (client fault)
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
