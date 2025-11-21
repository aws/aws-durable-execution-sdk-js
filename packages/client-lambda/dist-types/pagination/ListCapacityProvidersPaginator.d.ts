import { Paginator } from "@smithy/types";
import {
  ListCapacityProvidersCommandInput,
  ListCapacityProvidersCommandOutput,
} from "../commands/ListCapacityProvidersCommand";
import { LambdaPaginationConfiguration } from "./Interfaces";
/**
 * @public
 */
export declare const paginateListCapacityProviders: (
  config: LambdaPaginationConfiguration,
  input: ListCapacityProvidersCommandInput,
  ...rest: any[]
) => Paginator<ListCapacityProvidersCommandOutput>;
