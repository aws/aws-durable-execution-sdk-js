import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { InvokeWithResponseStreamRequest, InvokeWithResponseStreamResponse } from "../models/models_1";
import { Command as $Command } from "@smithy/smithy-client";
import { BlobPayloadInputTypes, MetadataBearer as __MetadataBearer } from "@smithy/types";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 */
export type InvokeWithResponseStreamCommandInputType = Omit<InvokeWithResponseStreamRequest, "Payload"> & {
    Payload?: BlobPayloadInputTypes;
};
/**
 * @public
 *
 * The input for {@link InvokeWithResponseStreamCommand}.
 */
export interface InvokeWithResponseStreamCommandInput extends InvokeWithResponseStreamCommandInputType {
}
/**
 * @public
 *
 * The output of {@link InvokeWithResponseStreamCommand}.
 */
export interface InvokeWithResponseStreamCommandOutput extends InvokeWithResponseStreamResponse, __MetadataBearer {
}
declare const InvokeWithResponseStreamCommand_base: {
    new (input: InvokeWithResponseStreamCommandInput): import("@smithy/smithy-client").CommandImpl<InvokeWithResponseStreamCommandInput, InvokeWithResponseStreamCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: InvokeWithResponseStreamCommandInput): import("@smithy/smithy-client").CommandImpl<InvokeWithResponseStreamCommandInput, InvokeWithResponseStreamCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, InvokeWithResponseStreamCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, InvokeWithResponseStreamCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // InvokeWithResponseStreamRequest
 *   FunctionName: "STRING_VALUE", // required
 *   InvocationType: "Event" || "RequestResponse" || "DryRun",
 *   LogType: "None" || "Tail",
 *   ClientContext: "STRING_VALUE",
 *   ContentType: "STRING_VALUE",
 *   SourceOwner: "STRING_VALUE",
 *   SourceArn: "STRING_VALUE",
 *   SourceAccount: "STRING_VALUE",
 *   EventSourceToken: "STRING_VALUE",
 *   Qualifier: "STRING_VALUE",
 *   TraceFields: "STRING_VALUE",
 *   InternalLambda: "STRING_VALUE",
 *   Payload: new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")
 *   TenantId: "STRING_VALUE",
 * };
 * const command = new InvokeWithResponseStreamCommand(input);
 * const response = await client.send(command);
 * // { // InvokeWithResponseStreamResponse
 * //   StatusCode: Number("int"),
 * //   ExecutedVersion: "STRING_VALUE",
 * //   TraceFields: "STRING_VALUE",
 * //   ContentType: "STRING_VALUE",
 * //   EventStream: { // InvokeWithResponseStreamResponseEvent Union: only one key present
 * //     PayloadChunk: { // InvokeResponseStreamUpdate
 * //       Payload: new Uint8Array(),
 * //     },
 * //     InvokeComplete: { // InvokeWithResponseStreamCompleteEvent
 * //       ErrorCode: "STRING_VALUE",
 * //       ErrorDetails: "STRING_VALUE",
 * //       LogResult: "STRING_VALUE",
 * //     },
 * //   },
 * // };
 *
 * ```
 *
 * @param InvokeWithResponseStreamCommandInput - {@link InvokeWithResponseStreamCommandInput}
 * @returns {@link InvokeWithResponseStreamCommandOutput}
 * @see {@link InvokeWithResponseStreamCommandInput} for command's `input` shape.
 * @see {@link InvokeWithResponseStreamCommandOutput} for command's `response` shape.
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
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link InvalidRequestContentException} (client fault)
 *
 * @throws {@link InvalidRuntimeException} (server fault)
 *
 * @throws {@link InvalidSecurityGroupIDException} (server fault)
 *
 * @throws {@link InvalidSubnetIDException} (server fault)
 *
 * @throws {@link InvalidZipFileException} (server fault)
 *
 * @throws {@link KMSAccessDeniedException} (server fault)
 *
 * @throws {@link KMSDisabledException} (server fault)
 *
 * @throws {@link KMSInvalidStateException} (server fault)
 *
 * @throws {@link KMSNotFoundException} (server fault)
 *
 * @throws {@link NoPublishedVersionException} (client fault)
 *
 * @throws {@link RecursiveInvocationException} (client fault)
 *
 * @throws {@link RequestTooLargeException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
 *
 * @throws {@link ResourceNotFoundException} (client fault)
 *
 * @throws {@link ResourceNotReadyException} (server fault)
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
 * @throws {@link TooManyRequestsException} (client fault)
 *
 * @throws {@link UnsupportedMediaTypeException} (client fault)
 *
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class InvokeWithResponseStreamCommand extends InvokeWithResponseStreamCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: InvokeWithResponseStreamRequest;
            output: InvokeWithResponseStreamResponse;
        };
        sdk: {
            input: InvokeWithResponseStreamCommandInput;
            output: InvokeWithResponseStreamCommandOutput;
        };
    };
}
