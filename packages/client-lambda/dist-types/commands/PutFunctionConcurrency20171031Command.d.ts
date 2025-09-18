import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { Concurrency } from "../models/models_0";
import { PutFunctionConcurrencyRequest20171031 } from "../models/models_1";
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
 * The input for {@link PutFunctionConcurrency20171031Command}.
 */
export interface PutFunctionConcurrency20171031CommandInput extends PutFunctionConcurrencyRequest20171031 {
}
/**
 * @public
 *
 * The output of {@link PutFunctionConcurrency20171031Command}.
 */
export interface PutFunctionConcurrency20171031CommandOutput extends Concurrency, __MetadataBearer {
}
declare const PutFunctionConcurrency20171031Command_base: {
    new (input: PutFunctionConcurrency20171031CommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionConcurrency20171031CommandInput, PutFunctionConcurrency20171031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: PutFunctionConcurrency20171031CommandInput): import("@smithy/smithy-client").CommandImpl<PutFunctionConcurrency20171031CommandInput, PutFunctionConcurrency20171031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, PutFunctionConcurrency20171031Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, PutFunctionConcurrency20171031Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // PutFunctionConcurrencyRequest20171031
 *   FunctionName: "STRING_VALUE", // required
 *   ReservedConcurrentExecutions: Number("int"), // required
 * };
 * const command = new PutFunctionConcurrency20171031Command(input);
 * const response = await client.send(command);
 * // { // Concurrency
 * //   ReservedConcurrentExecutions: Number("int"),
 * // };
 *
 * ```
 *
 * @param PutFunctionConcurrency20171031CommandInput - {@link PutFunctionConcurrency20171031CommandInput}
 * @returns {@link PutFunctionConcurrency20171031CommandOutput}
 * @see {@link PutFunctionConcurrency20171031CommandInput} for command's `input` shape.
 * @see {@link PutFunctionConcurrency20171031CommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
 *
 * @throws {@link ResourceConflictException} (client fault)
 *
 * @throws {@link ResourceNotFoundException} (client fault)
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
export declare class PutFunctionConcurrency20171031Command extends PutFunctionConcurrency20171031Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: PutFunctionConcurrencyRequest20171031;
            output: Concurrency;
        };
        sdk: {
            input: PutFunctionConcurrency20171031CommandInput;
            output: PutFunctionConcurrency20171031CommandOutput;
        };
    };
}
