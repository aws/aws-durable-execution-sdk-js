import { getHttpAuthExtensionConfiguration, resolveHttpAuthRuntimeConfig, } from "./auth/httpAuthExtensionConfiguration";
import { getAwsRegionExtensionConfiguration, resolveAwsRegionExtensionConfiguration, } from "@aws-sdk/region-config-resolver";
import { getHttpHandlerExtensionConfiguration, resolveHttpHandlerRuntimeConfig, } from "@smithy/protocol-http";
import { getDefaultExtensionConfiguration, resolveDefaultRuntimeConfig, } from "@smithy/smithy-client";
export const resolveRuntimeExtensions = (runtimeConfig, extensions) => {
    const extensionConfiguration = Object.assign(getAwsRegionExtensionConfiguration(runtimeConfig), getDefaultExtensionConfiguration(runtimeConfig), getHttpHandlerExtensionConfiguration(runtimeConfig), getHttpAuthExtensionConfiguration(runtimeConfig));
    extensions.forEach(extension => extension.configure(extensionConfiguration));
    return Object.assign(runtimeConfig, resolveAwsRegionExtensionConfiguration(extensionConfiguration), resolveDefaultRuntimeConfig(extensionConfiguration), resolveHttpHandlerRuntimeConfig(extensionConfiguration), resolveHttpAuthRuntimeConfig(extensionConfiguration));
};
