import { LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes } from "../LambdaClient";
import { ListLayersRequest20181031, ListLayersResponse20181031 } from "../models/models_1";
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
 * The input for {@link ListLayers20181031Command}.
 */
export interface ListLayers20181031CommandInput extends ListLayersRequest20181031 {
}
/**
 * @public
 *
 * The output of {@link ListLayers20181031Command}.
 */
export interface ListLayers20181031CommandOutput extends ListLayersResponse20181031, __MetadataBearer {
}
declare const ListLayers20181031Command_base: {
    new (input: ListLayers20181031CommandInput): import("@smithy/smithy-client").CommandImpl<ListLayers20181031CommandInput, ListLayers20181031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    new (...[input]: [] | [ListLayers20181031CommandInput]): import("@smithy/smithy-client").CommandImpl<ListLayers20181031CommandInput, ListLayers20181031CommandOutput, LambdaClientResolvedConfig, ServiceInputTypes, ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/middleware-endpoint").EndpointParameterInstructions;
};
/**
 * @public
 *
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { LambdaClient, ListLayers20181031Command } from "@amzn/lambda-console-sdk-client-lambda"; // ES Modules import
 * // const { LambdaClient, ListLayers20181031Command } = require("@amzn/lambda-console-sdk-client-lambda"); // CommonJS import
 * const client = new LambdaClient(config);
 * const input = { // ListLayersRequest20181031
 *   CompatibleArchitecture: "x86_64" || "arm64",
 *   CompatibleRuntime: "nodejs" || "nodejs4.3" || "nodejs6.10" || "nodejs8.10" || "nodejs10.x" || "nodejs12.x" || "nodejs14.x" || "nodejs16.x" || "nodejs18.x" || "nodejs20.x" || "nodejs22.x" || "nodejs24.x" || "java8" || "java8.al2" || "java11" || "java17" || "java21" || "java25" || "python2.7" || "python3.6" || "python3.7" || "python3.8" || "python3.9" || "python3.10" || "python3.11" || "python3.12" || "python3.13" || "python3.14" || "dotnetcore1.0" || "dotnetcore2.0" || "dotnetcore2.1" || "dotnetcore3.1" || "dotnet6" || "dotnet8" || "dotnet10" || "nodejs4.3-edge" || "python2.7-greengrass" || "byol" || "go1.9" || "go1.x" || "ruby2.5" || "ruby2.7" || "ruby3.2" || "ruby3.3" || "ruby3.4" || "provided" || "provided.al2" || "provided.al2023",
 *   Marker: "STRING_VALUE",
 *   MaxItems: Number("int"),
 * };
 * const command = new ListLayers20181031Command(input);
 * const response = await client.send(command);
 * // { // ListLayersResponse20181031
 * //   NextMarker: "STRING_VALUE",
 * //   Layers: [ // LayersList20181031
 * //     { // LayersListItem20181031
 * //       LayerName: "STRING_VALUE",
 * //       LayerArn: "STRING_VALUE",
 * //       LatestMatchingVersion: { // LayerVersionsListItem20181031
 * //         LayerVersionArn: "STRING_VALUE",
 * //         Version: Number("long"),
 * //         Description: "STRING_VALUE",
 * //         CreatedDate: "STRING_VALUE",
 * //         CompatibleArchitectures: [ // CompatibleArchitectures
 * //           "x86_64" || "arm64",
 * //         ],
 * //         CompatibleRuntimes: [ // CompatibleRuntimes
 * //           "nodejs" || "nodejs4.3" || "nodejs6.10" || "nodejs8.10" || "nodejs10.x" || "nodejs12.x" || "nodejs14.x" || "nodejs16.x" || "nodejs18.x" || "nodejs20.x" || "nodejs22.x" || "nodejs24.x" || "java8" || "java8.al2" || "java11" || "java17" || "java21" || "java25" || "python2.7" || "python3.6" || "python3.7" || "python3.8" || "python3.9" || "python3.10" || "python3.11" || "python3.12" || "python3.13" || "python3.14" || "dotnetcore1.0" || "dotnetcore2.0" || "dotnetcore2.1" || "dotnetcore3.1" || "dotnet6" || "dotnet8" || "dotnet10" || "nodejs4.3-edge" || "python2.7-greengrass" || "byol" || "go1.9" || "go1.x" || "ruby2.5" || "ruby2.7" || "ruby3.2" || "ruby3.3" || "ruby3.4" || "provided" || "provided.al2" || "provided.al2023",
 * //         ],
 * //         LicenseInfo: "STRING_VALUE",
 * //       },
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListLayers20181031CommandInput - {@link ListLayers20181031CommandInput}
 * @returns {@link ListLayers20181031CommandOutput}
 * @see {@link ListLayers20181031CommandInput} for command's `input` shape.
 * @see {@link ListLayers20181031CommandOutput} for command's `response` shape.
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
export declare class ListLayers20181031Command extends ListLayers20181031Command_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListLayersRequest20181031;
            output: ListLayersResponse20181031;
        };
        sdk: {
            input: ListLayers20181031CommandInput;
            output: ListLayers20181031CommandOutput;
        };
    };
}
