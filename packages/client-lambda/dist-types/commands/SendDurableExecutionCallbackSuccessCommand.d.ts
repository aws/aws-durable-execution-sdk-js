import { Command as $Command } from "@smithy/smithy-client";
import {
  BlobPayloadInputTypes,
  MetadataBearer as __MetadataBearer,
} from "@smithy/types";
import {
  LambdaClientResolvedConfig,
  ServiceInputTypes,
  ServiceOutputTypes,
} from "../LambdaClient";
import {
  SendDurableExecutionCallbackSuccessRequest,
  SendDurableExecutionCallbackSuccessResponse,
} from "../models/models_1";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 */
export type SendDurableExecutionCallbackSuccessCommandInputType = Omit<
  SendDurableExecutionCallbackSuccessRequest,
  "Result"
> & {
  Result?: BlobPayloadInputTypes;
};
/**
 * @public
 *
 * The input for {@link SendDurableExecutionCallbackSuccessCommand}.
 */
export interface SendDurableExecutionCallbackSuccessCommandInput
  extends SendDurableExecutionCallbackSuccessCommandInputType {}
/**
 * @public
 *
 * The output of {@link SendDurableExecutionCallbackSuccessCommand}.
 */
export interface SendDurableExecutionCallbackSuccessCommandOutput
  extends SendDurableExecutionCallbackSuccessResponse,
    __MetadataBearer {}
declare const SendDurableExecutionCallbackSuccessCommand_base: {
  new (
    input: SendDurableExecutionCallbackSuccessCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    SendDurableExecutionCallbackSuccessCommandInput,
    SendDurableExecutionCallbackSuccessCommandOutput,
    LambdaClientResolvedConfig,
    ServiceInputTypes,
    ServiceOutputTypes
  >;
  new (
    input: SendDurableExecutionCallbackSuccessCommandInput,
  ): import("@smithy/smithy-client").CommandImpl<
    SendDurableExecutionCallbackSuccessCommandInput,
    SendDurableExecutionCallbackSuccessCommandOutput,
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
 * import { LambdaClient, SendDurableExecutionCallbackSuccessCommand } from "@aws-sdk/client-lambda"; // ES Modules import
 * // const { LambdaClient, SendDurableExecutionCallbackSuccessCommand } = require("@aws-sdk/client-lambda"); // CommonJS import
 * // import type { LambdaClientConfig } from "@aws-sdk/client-lambda";
 * const config = {}; // type is LambdaClientConfig
 * const client = new LambdaClient(config);
 * const input = { // SendDurableExecutionCallbackSuccessRequest
 *   CallbackId: "STRING_VALUE", // required
 *   Result: new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")
 * };
 * const command = new SendDurableExecutionCallbackSuccessCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param SendDurableExecutionCallbackSuccessCommandInput - {@link SendDurableExecutionCallbackSuccessCommandInput}
 * @returns {@link SendDurableExecutionCallbackSuccessCommandOutput}
 * @see {@link SendDurableExecutionCallbackSuccessCommandInput} for command's `input` shape.
 * @see {@link SendDurableExecutionCallbackSuccessCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link CallbackTimeoutException} (client fault)
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
export declare class SendDurableExecutionCallbackSuccessCommand extends SendDurableExecutionCallbackSuccessCommand_base {
  /** @internal type navigation helper, not in runtime. */
  protected static __types: {
    api: {
      input: SendDurableExecutionCallbackSuccessRequest;
      output: {};
    };
    sdk: {
      input: SendDurableExecutionCallbackSuccessCommandInput;
      output: SendDurableExecutionCallbackSuccessCommandOutput;
    };
  };
}
