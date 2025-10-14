import { createPaginator } from "@smithy/core";
import { GetDurableExecutionHistoryCommand, } from "../commands/GetDurableExecutionHistoryCommand";
import { LambdaClient } from "../LambdaClient";
export const paginateGetDurableExecutionHistory = createPaginator(LambdaClient, GetDurableExecutionHistoryCommand, "Marker", "NextMarker", "MaxItems");
