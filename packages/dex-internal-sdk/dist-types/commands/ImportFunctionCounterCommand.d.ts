import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ImportFunctionCounterRequest, ImportFunctionCounterResponse } from "../models/models_1";
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
 * The input for {@link ImportFunctionCounterCommand}.
 */
export interface ImportFunctionCounterCommandInput extends ImportFunctionCounterRequest {
}
/**
 * @public
 *
 * The output of {@link ImportFunctionCounterCommand}.
 */
export interface ImportFunctionCounterCommandOutput extends ImportFunctionCounterResponse, __MetadataBearer {
}
declare const ImportFunctionCounterCommand_base: {
    new (input: ImportFunctionCounterCommandInput): import("@smithy/smithy-client").CommandImpl<ImportFunctionCounterCommandInput, ImportFunctionCounterCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: ImportFunctionCounterCommandInput): import("@smithy/smithy-client").CommandImpl<ImportFunctionCounterCommandInput, ImportFunctionCounterCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ImportFunctionCounterCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ImportFunctionCounterCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ImportFunctionCounterRequest
 *   FunctionName: "STRING_VALUE", // required
 *   CurrentVersionNumber: Number("long"), // required
 * };
 * const command = new ImportFunctionCounterCommand(input);
 * const response = await client.send(command);
 * // { // ImportFunctionCounterResponse
 * //   FunctionCounter: { // FunctionCounterInternal
 * //     FunctionArn: "STRING_VALUE",
 * //     CurrentVersionNumber: Number("long"),
 * //   },
 * // };
 *
 * ```
 *
 * @param ImportFunctionCounterCommandInput - {@link ImportFunctionCounterCommandInput}
 * @returns {@link ImportFunctionCounterCommandOutput}
 * @see {@link ImportFunctionCounterCommandInput} for command's `input` shape.
 * @see {@link ImportFunctionCounterCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
 *
 * @throws {@link ServiceException} (server fault)
 *
 * @throws {@link TooManyRequestsException} (client fault)
 *
 * @throws {@link LambdaServiceException}
 * <p>Base exception class for all service exceptions from Lambda service.</p>
 *
 *
 */
export declare class ImportFunctionCounterCommand extends ImportFunctionCounterCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ImportFunctionCounterRequest;
            output: ImportFunctionCounterResponse;
        };
        sdk: {
            input: ImportFunctionCounterCommandInput;
            output: ImportFunctionCounterCommandOutput;
        };
    };
}
