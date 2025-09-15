import { LambdaClient } from "../LambdaClient";
import { GetDurableExecutionHistoryCommand, } from "../commands/GetDurableExecutionHistoryCommand";
import { createPaginator } from "@smithy/core";
export const paginateGetDurableExecutionHistory = createPaginator(LambdaClient, GetDurableExecutionHistoryCommand, "Marker", "NextMarker", "MaxItems");
