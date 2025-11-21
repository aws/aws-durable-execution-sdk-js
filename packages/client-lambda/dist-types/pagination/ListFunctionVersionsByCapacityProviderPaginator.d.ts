import { Paginator } from "@smithy/types";
import {
  ListFunctionVersionsByCapacityProviderCommandInput,
  ListFunctionVersionsByCapacityProviderCommandOutput,
} from "../commands/ListFunctionVersionsByCapacityProviderCommand";
import { LambdaPaginationConfiguration } from "./Interfaces";
/**
 * @public
 */
export declare const paginateListFunctionVersionsByCapacityProvider: (
  config: LambdaPaginationConfiguration,
  input: ListFunctionVersionsByCapacityProviderCommandInput,
  ...rest: any[]
) => Paginator<ListFunctionVersionsByCapacityProviderCommandOutput>;
