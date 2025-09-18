import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { InvocationRequest, InvocationResponse } from "../models/models_1";
import { Command as $Command } from "@smithy/smithy-client";
import { BlobPayloadInputTypes, MetadataBearer as __MetadataBearer } from "@smithy/types";
import { Uint8ArrayBlobAdapter } from "@smithy/util-stream";
/**
 * @public
 */
export type { __MetadataBearer };
export { $Command };
/**
 * @public
 */
export type Invoke20150331CommandInputType = Omit<InvocationRequest, "Payload"> & {
    Payload?: BlobPayloadInputTypes;
};
/**
 * @public
 *
 * The input for {@link Invoke20150331Command}.
 */
export interface Invoke20150331CommandInput extends Invoke20150331CommandInputType {
}
/**
 * @public
 */
export type Invoke20150331CommandOutputType = Omit<InvocationResponse, "Payload"> & {
    Payload?: Uint8ArrayBlobAdapter;
};
/**
 * @public
 *
 * The output of {@link Invoke20150331Command}.
 */
export interface Invoke20150331CommandOutput extends Invoke20150331CommandOutputType, __MetadataBearer {
}
declare const Invoke20150331Command_base: {
    new (input: Invoke20150331CommandInput): import("@smithy/smithy-client").CommandImpl<Invoke20150331CommandInput, Invoke20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: Invoke20150331CommandInput): import("@smithy/smithy-client").CommandImpl<Invoke20150331CommandInput, Invoke20150331CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, Invoke20150331Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, Invoke20150331Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // InvocationRequest
 *   FunctionName: "STRING_VALUE", // required
 *   InvocationType: "Event" || "RequestResponse" || "DryRun",
 *   SourceArn: "STRING_VALUE",
 *   LogType: "None" || "Tail",
 *   ClientContext: "STRING_VALUE",
 *   DurableExecutionName: "STRING_VALUE",
 *   ContentType: "STRING_VALUE",
 *   SourceAccount: "STRING_VALUE",
 *   EventSourceToken: "STRING_VALUE",
 *   Payload: new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")
 *   Qualifier: "STRING_VALUE",
 *   TraceFields: "STRING_VALUE",
 *   InternalLambda: "STRING_VALUE",
 *   OnSuccessDestinationArn: "STRING_VALUE",
 *   OnFailureDestinationArn: "STRING_VALUE",
 *   TenantId: "STRING_VALUE",
 *   DurableFunctionInvokeExecution: true || false,
 * };
 * const command = new Invoke20150331Command(input);
 * const response = await client.send(command);
 * // { // InvocationResponse
 * //   StatusCode: Number("int"),
 * //   FunctionError: "STRING_VALUE",
 * //   LogResult: "STRING_VALUE",
 * //   ContentType: "STRING_VALUE",
 * //   FunctionResponseMode: "STRING_VALUE",
 * //   ContentLength: Number("int"),
 * //   TraceFields: "STRING_VALUE",
 * //   Payload: new Uint8Array(),
 * //   ExecutedVersion: "STRING_VALUE",
 * //   DurableExecutionArn: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param Invoke20150331CommandInput - {@link Invoke20150331CommandInput}
 * @returns {@link Invoke20150331CommandOutput}
 * @see {@link Invoke20150331CommandInput} for command's `input` shape.
 * @see {@link Invoke20150331CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link DurableExecutionAlreadyStartedException} (client fault)
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
 * @throws {@link ModeNotSupportedException} (client fault)
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
export declare class Invoke20150331Command extends Invoke20150331Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: InvocationRequest;
            output: InvocationResponse;
        };
        sdk: {
            input: Invoke20150331CommandInput;
            output: Invoke20150331CommandOutput;
        };
    };
}
