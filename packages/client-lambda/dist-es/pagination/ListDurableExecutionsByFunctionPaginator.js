import { createPaginator } from "@smithy/core";
import { ListDurableExecutionsByFunctionCommand, } from "../commands/ListDurableExecutionsByFunctionCommand";
import { LambdaClient } from "../LambdaClient";
export const paginateListDurableExecutionsByFunction = createPaginator(LambdaClient, ListDurableExecutionsByFunctionCommand, "Marker", "NextMarker", "MaxItems");
