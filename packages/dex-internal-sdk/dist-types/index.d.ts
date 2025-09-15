/**
 * AWS Gir API Service
 *     - currently support GET/POST/PUT/DELETE for the Invoke API
 *
 * @packageDocumentation
 */
export * from "./LambdaClient";
export * from "./Lambda";
export { ClientInputEndpointParameters } from "./endpoint/EndpointParameters";
export type { RuntimeExtension } from "./runtimeExtensions";
export type { LambdaExtensionConfiguration } from "./extensionConfiguration";
export * from "./commands";
export * from "./pagination";
export * from "./models";
export { LambdaServiceException } from "./models/LambdaServiceException";
