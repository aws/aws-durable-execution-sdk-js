import { Paginator } from "@smithy/types";
import { ListDurableExecutionsCommandInput, ListDurableExecutionsCommandOutput } from "../commands/ListDurableExecutionsCommand";
import { LambdaPaginationConfiguration } from "./Interfaces";
/**
 * @public
 */
export declare const paginateListDurableExecutions: (config: LambdaPaginationConfiguration, input: ListDurableExecutionsCommandInput, ...rest: any[]) => Paginator<ListDurableExecutionsCommandOutput>;
