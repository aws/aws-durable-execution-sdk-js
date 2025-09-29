import { Paginator } from "@smithy/types";
import { GetDurableExecutionStateCommandInput, GetDurableExecutionStateCommandOutput } from "../commands/GetDurableExecutionStateCommand";
import { LambdaPaginationConfiguration } from "./Interfaces";
/**
 * @public
 */
export declare const paginateGetDurableExecutionState: (config: LambdaPaginationConfiguration, input: GetDurableExecutionStateCommandInput, ...rest: any[]) => Paginator<GetDurableExecutionStateCommandOutput>;
