import { EndpointParameters } from "./EndpointParameters";
import { EndpointV2, Logger } from "@smithy/types";
export declare const defaultEndpointResolver: (endpointParams: EndpointParameters, context?: {
    logger?: Logger;
}) => EndpointV2;
