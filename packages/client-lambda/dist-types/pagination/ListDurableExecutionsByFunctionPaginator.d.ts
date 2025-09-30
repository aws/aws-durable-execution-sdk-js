import { Paginator } from "@smithy/types";
import { ListDurableExecutionsByFunctionCommandInput, ListDurableExecutionsByFunctionCommandOutput } from "../commands/ListDurableExecutionsByFunctionCommand";
import { LambdaPaginationConfiguration } from "./Interfaces";
/**
 * @public
 */
export declare const paginateListDurableExecutionsByFunction: (config: LambdaPaginationConfiguration, input: ListDurableExecutionsByFunctionCommandInput, ...rest: any[]) => Paginator<ListDurableExecutionsByFunctionCommandOutput>;
