import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { GetAccountRiskSettingsRequest, GetAccountRiskSettingsResponse } from "../models/models_0";
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
 * The input for {@link GetAccountRiskSettingsCommand}.
 */
export interface GetAccountRiskSettingsCommandInput extends GetAccountRiskSettingsRequest {
}
/**
 * @public
 *
 * The output of {@link GetAccountRiskSettingsCommand}.
 */
export interface GetAccountRiskSettingsCommandOutput extends GetAccountRiskSettingsResponse, __MetadataBearer {
}
declare const GetAccountRiskSettingsCommand_base: {
    new (input: GetAccountRiskSettingsCommandInput): import("@smithy/smithy-client").CommandImpl<GetAccountRiskSettingsCommandInput, GetAccountRiskSettingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: GetAccountRiskSettingsCommandInput): import("@smithy/smithy-client").CommandImpl<GetAccountRiskSettingsCommandInput, GetAccountRiskSettingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, GetAccountRiskSettingsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, GetAccountRiskSettingsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // GetAccountRiskSettingsRequest
 *   AccountId: "STRING_VALUE", // required
 * };
 * const command = new GetAccountRiskSettingsCommand(input);
 * const response = await client.send(command);
 * // { // GetAccountRiskSettingsResponse
 * //   RiskSettings: { // AccountRiskSettings
 * //     RiskStatus: Number("int"), // required
 * //     RiskDetectedTime: new Date("TIMESTAMP"), // required
 * //     RiskSource: "STRING_VALUE",
 * //     ContainmentScore: Number("int"), // required
 * //   },
 * //   AccountBlacklistedForAccountRiskMitigation: true || false, // required
 * // };
 *
 * ```
 *
 * @param GetAccountRiskSettingsCommandInput - {@link GetAccountRiskSettingsCommandInput}
 * @returns {@link GetAccountRiskSettingsCommandOutput}
 * @see {@link GetAccountRiskSettingsCommandInput} for command's `input` shape.
 * @see {@link GetAccountRiskSettingsCommandOutput} for command's `response` shape.
 * @see {@link LambdaClientResolvedConfig | config} for LambdaClient's `config` shape.
 *
 * @throws {@link InvalidParameterValueException} (client fault)
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
export declare class GetAccountRiskSettingsCommand extends GetAccountRiskSettingsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetAccountRiskSettingsRequest;
            output: GetAccountRiskSettingsResponse;
        };
        sdk: {
            input: GetAccountRiskSettingsCommandInput;
            output: GetAccountRiskSettingsCommandOutput;
        };
    };
}
