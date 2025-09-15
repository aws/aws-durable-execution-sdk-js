import { ruleSet } from "./ruleset";
import { awsEndpointFunctions } from "@aws-sdk/util-endpoints";
import { EndpointCache, customEndpointFunctions, resolveEndpoint, } from "@smithy/util-endpoints";
const cache = new EndpointCache({
    size: 50,
    params: ["Endpoint",
        "Region",
        "UseDualStack",
        "UseFIPS"]
});
export const defaultEndpointResolver = (endpointParams, context = {}) => {
    return cache.get(endpointParams, () => resolveEndpoint(ruleSet, {
        endpointParams: endpointParams,
        logger: context.logger,
    }));
};
customEndpointFunctions.aws = awsEndpointFunctions;
