import { LambdaClient } from "../LambdaClient";
import { GetDurableExecutionStateCommand, } from "../commands/GetDurableExecutionStateCommand";
import { createPaginator } from "@smithy/core";
export const paginateGetDurableExecutionState = createPaginator(LambdaClient, GetDurableExecutionStateCommand, "Marker", "NextMarker", "MaxItems");
