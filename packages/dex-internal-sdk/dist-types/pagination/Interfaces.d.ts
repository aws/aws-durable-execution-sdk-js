import { LambdaClient } from "../LambdaClient";
import { PaginationConfiguration } from "@smithy/types";
/**
 * @public
 */
export interface LambdaPaginationConfiguration extends PaginationConfiguration {
    client: LambdaClient;
}
