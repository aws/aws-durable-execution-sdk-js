import {
  GetDurableExecutionStateCommandInput,
  GetDurableExecutionStateCommandOutput,
} from "../commands/GetDurableExecutionStateCommand";
import { LambdaPaginationConfiguration } from "./Interfaces";
import { Paginator } from "@smithy/types";
/**
 * @public
 */
export declare const paginateGetDurableExecutionState: (
  config: LambdaPaginationConfiguration,
  input: GetDurableExecutionStateCommandInput,
  ...rest: any[]
) => Paginator<GetDurableExecutionStateCommandOutput>;
