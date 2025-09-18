import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { InvokeAsyncRequest, InvokeAsyncResponse } from "../models/models_1";
import { Command as $Command } from "@smithy/smithy-client";
import { BlobPayloadInputTypes, StreamingBlobPayloadOutputTypes, MetadataBearer as __MetadataBearer } from "@smithy/types";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 */
export type InvokeAsyncCommandInputType = Omit<InvokeAsyncRequest, "InvokeArgs"> & {
    InvokeArgs: BlobPayloadInputTypes;
};
/**
 * @public
 *
 * The input for {@link InvokeAsyncCommand}.
 */
export interface InvokeAsyncCommandInput extends InvokeAsyncCommandInputType {
}
/**
 * @public
 *
 * The output of {@link InvokeAsyncCommand}.
 */
export interface InvokeAsyncCommandOutput extends Omit<InvokeAsyncResponse, "Body">, __MetadataBearer {
    Body?: StreamingBlobPayloadOutputTypes;
}
declare const InvokeAsyncCommand_base: {
    new (input: InvokeAsyncCommandInput): import("@smithy/smithy-client").CommandImpl<InvokeAsyncCommandInput, InvokeAsyncCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: InvokeAsyncCommandInput): import("@smithy/smithy-client").CommandImpl<InvokeAsyncCommandInput, InvokeAsyncCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 * @deprecated
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, InvokeAsyncCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, InvokeAsyncCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // InvokeAsyncRequest
 *   FunctionName: "STRING_VALUE", // required
 *   InternalLambda: "STRING_VALUE",
 *   DryRun: true || false,
 *   InvokeArgs: new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")   // required
 *   SourceArn: "STRING_VALUE",
 * };
 * const command = new InvokeAsyncCommand(input);
 * const response = await client.send(command);
 * // consume or destroy the stream to free the socket.
 * const bytes = await response.Body.transformToByteArray();
 * // const str = await response.Body.transformToString();
 * // response.Body.destroy(); // only applicable to Node.js Readable streams.
 *
 * // { // InvokeAsyncResponse
 * //   Status: Number("int"),
 * //   Body: "<SdkStream>", // see \@smithy/types -> StreamingBlobPayloadOutputTypes
 * // };
 *
 * ```
 *
 * @param InvokeAsyncCommandInput - {@link InvokeAsyncCommandInput}
 * @returns {@link InvokeAsyncCommandOutput}
 * @see {@link InvokeAsyncCommandInput} for command's `input` shape.
 * @see {@link InvokeAsyncCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link EC2AccessDeniedException} (server fault)
 *
 * @throws {@link EC2ThrottledException} (server fault)
 *
 * @throws {@link EC2UnexpectedException} (server fault)
 *
 * @throws {@link EFSIOException} (client fault)
 *
 * @throws {@link EFSMountConnectivityException} (client fault)
 *
 * @throws {@link EFSMountFailureException} (client fault)
 *
 * @throws {@link EFSMountTimeoutException} (client fault)
 *
 * @throws {@link ENILimitReachedException} (server fault)
 *
 * @throws {@link InvalidRequestContentException} (client fault)
 *
 * @throws {@link InvalidRuntimeException} (server fault)
 *
 * @throws {@link InvalidSecurityGroupIDException} (server fault)
 *
 * @throws {@link InvalidSubnetIDException} (server fault)
 *
 * @throws {@link KMSAccessDeniedException} (server fault)
 *
 * @throws {@link KMSDisabledException} (server fault)
 *
 * @throws {@link KMSInvalidStateException} (server fault)
 *
 * @throws {@link KMSNotFoundException} (server fault)
 *
 * @throws {@link ModeNotSupportedException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
 *
 * @throws {@link ResourceNotFoundException} (client fault)
 *
 * @throws {@link ServiceException} (server fault)
 *
 * @throws {@link SnapRestoreException} (client fault)
 *
 * @throws {@link SnapRestoreTimeoutException} (client fault)
 *
 * @throws {@link SnapStartException} (client fault)
 *
 * @throws {@link SnapStartNotReadyException} (client fault)
 *
 * @throws {@link SnapStartRegenerationFailureException} (client fault)
 *
 * @throws {@link SnapStartTimeoutException} (client fault)
 *
 * @throws {@link SubnetIPAddressLimitReachedException} (server fault)
 *
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class InvokeAsyncCommand extends InvokeAsyncCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: InvokeAsyncRequest;
            output: InvokeAsyncResponse;
        };
        sdk: {
            input: InvokeAsyncCommandInput;
            output: InvokeAsyncCommandOutput;
        };
    };
}
