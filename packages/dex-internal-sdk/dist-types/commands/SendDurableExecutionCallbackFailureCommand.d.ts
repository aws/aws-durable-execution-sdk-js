import {
  LambdaClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from "../LambdaClient";
import {
  SendDurableExecutionCallbackFailureRequest,
  SendDurableExecutionCallbackFailureResponse,
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
 * The input for {@link SendDurableExecutionCallbackFailureCommand}.
 */
export interface SendDurableExecutionCallbackFailureCommandInput
  extends SendDurableExecutionCallbackFailureRequest {}
/**
 * @public
 *
 * The output of {@link SendDurableExecutionCallbackFailureCommand}.
 */
export interface SendDurableExecutionCallbackFailureCommandOutput
  extends SendDurableExecutionCallbackFailureResponse,
    __MetadataBearer {}
declare const SendDurableExecutionCallbackFailureCommand_base: {
  new (
    input: SendDurableExecutionCallbackFailureCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    SendDurableExecutionCallbackFailureCommandInput,
    SendDurableExecutionCallbackFailureCommandOutput,
    LambdaClientResolvedConfig,
    ServiceInputTypes,
    ServiceOutputTypes
  >;
  new (
    input: SendDurableExecutionCallbackFailureCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    SendDurableExecutionCallbackFailureCommandInput,
    SendDurableExecutionCallbackFailureCommandOutput,
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
 * import { LambdaClient, SendDurableExecutionCallbackFailureCommand } from "@amzn/dex-internal-sdk"; // ES Modules import
 * // const { LambdaClient, SendDurableExecutionCallbackFailureCommand } = require("@amzn/dex-internal-sdk"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // SendDurableExecutionCallbackFailureRequest
 *   CallbackId: "STRING_VALUE", // required
 *   Error: { // ErrorObject
 *     ErrorMessage: "STRING_VALUE",
 *     ErrorType: "STRING_VALUE",
 *     ErrorData: "STRING_VALUE",
 *     StackTrace: [ // StackTraceEntries
 *       "STRING_VALUE",
 *     ],
 *   },
 * };
 * const command = new SendDurableExecutionCallbackFailureCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param SendDurableExecutionCallbackFailureCommandInput - {@link SendDurableExecutionCallbackFailureCommandInput}
 * @returns {@link SendDurableExecutionCallbackFailureCommandOutput}
 * @see {@link SendDurableExecutionCallbackFailureCommandInput} for command's `input` shape.
 * @see {@link SendDurableExecutionCallbackFailureCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link CallbackTimeoutException} (client fault)
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
export declare class SendDurableExecutionCallbackFailureCommand extends SendDurableExecutionCallbackFailureCommand_base {
  /** @internal type navigation helper, not in runtime. */
  protected static __types: {
    api: {
      input: SendDurableExecutionCallbackFailureRequest;
      output: {};
    };
    sdk: {
      input: SendDurableExecutionCallbackFailureCommandInput;
      output: SendDurableExecutionCallbackFailureCommandOutput;
    };
  };
}
