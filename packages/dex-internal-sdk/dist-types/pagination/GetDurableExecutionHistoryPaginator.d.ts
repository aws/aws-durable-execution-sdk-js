import {
  GetDurableExecutionHistoryCommandInput,
  GetDurableExecutionHistoryCommandOutput,
} from "../commands/GetDurableExecutionHistoryCommand";
import { LambdaPaginationConfiguration } from "./Interfaces";
import { Paginator } from "@smithy/types";
/**
 * @public
 */
export declare const paginateGetDurableExecutionHistory: (
  config: LambdaPaginationConfiguration,
  input: GetDurableExecutionHistoryCommandInput,
  ...rest: any[]
) => Paginator<GetDurableExecutionHistoryCommandOutput>;
