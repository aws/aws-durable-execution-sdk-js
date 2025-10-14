import { createPaginator } from "@smithy/core";
import { GetDurableExecutionStateCommand, } from "../commands/GetDurableExecutionStateCommand";
import { LambdaClient } from "../LambdaClient";
export const paginateGetDurableExecutionState = createPaginator(LambdaClient, GetDurableExecutionStateCommand, "Marker", "NextMarker", "MaxItems");
