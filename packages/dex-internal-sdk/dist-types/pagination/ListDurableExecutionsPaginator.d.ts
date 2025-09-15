import { ListDurableExecutionsCommandInput, ListDurableExecutionsCommandOutput } from "../commands/ListDurableExecutionsCommand";
import { LambdaPaginationConfiguration } from "./Interfaces";
import { Paginator } from "@smithy/types";
/**
 * @public
 */
export declare const paginateListDurableExecutions: (config: LambdaPaginationConfiguration, input: ListDurableExecutionsCommandInput, ...rest: any[]) => Paginator<ListDurableExecutionsCommandOutput>;
