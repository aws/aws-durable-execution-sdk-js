import {
  LambdaClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from "../LambdaClient";
import {
  StopDurableExecutionRequest,
  StopDurableExecutionResponse,
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
 * import { LambdaClient, StopDurableExecutionCommand } from "@amzn/dex-internal-sdk"; // ES Modules import
 * // const { LambdaClient, StopDurableExecutionCommand } = require("@amzn/dex-internal-sdk"); // CommonJS import
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
 * //   StopDate: new Date("TIMESTAMP"),
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
