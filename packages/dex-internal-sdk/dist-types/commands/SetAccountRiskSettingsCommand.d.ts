import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { SetAccountRiskSettingsRequest } from "../models/models_1";
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
 * The input for {@link SetAccountRiskSettingsCommand}.
 */
export interface SetAccountRiskSettingsCommandInput extends SetAccountRiskSettingsRequest {
}
/**
 * @public
 *
 * The output of {@link SetAccountRiskSettingsCommand}.
 */
export interface SetAccountRiskSettingsCommandOutput extends __MetadataBearer {
}
declare const SetAccountRiskSettingsCommand_base: {
    new (input: SetAccountRiskSettingsCommandInput): import("@smithy/smithy-client").CommandImpl<SetAccountRiskSettingsCommandInput, SetAccountRiskSettingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (input: SetAccountRiskSettingsCommandInput): import("@smithy/smithy-client").CommandImpl<SetAccountRiskSettingsCommandInput, SetAccountRiskSettingsCommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @internal
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, SetAccountRiskSettingsCommand } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, SetAccountRiskSettingsCommand } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // SetAccountRiskSettingsRequest
 *   AccountId: "STRING_VALUE", // required
 *   RiskSettings: { // AccountRiskSettings
 *     RiskStatus: Number("int"), // required
 *     RiskDetectedTime: new Date("TIMESTAMP"), // required
 *     RiskSource: "STRING_VALUE",
 *     ContainmentScore: Number("int"), // required
 *   },
 * };
 * const command = new SetAccountRiskSettingsCommand(input);
 * const response = await client.send(command);
 * // {};
 *
 * ```
 *
 * @param SetAccountRiskSettingsCommandInput - {@link SetAccountRiskSettingsCommandInput}
 * @returns {@link SetAccountRiskSettingsCommandOutput}
 * @see {@link SetAccountRiskSettingsCommandInput} for command's `input` shape.
 * @see {@link SetAccountRiskSettingsCommandOutput} for command's `response` shape.
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
export declare class SetAccountRiskSettingsCommand extends SetAccountRiskSettingsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: SetAccountRiskSettingsRequest;
            output: {};
        };
        sdk: {
            input: SetAccountRiskSettingsCommandInput;
            output: SetAccountRiskSettingsCommandOutput;
        };
    };
}
