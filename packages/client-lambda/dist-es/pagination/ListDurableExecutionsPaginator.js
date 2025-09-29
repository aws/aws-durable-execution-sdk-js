import { createPaginator } from "@smithy/core";
import { ListDurableExecutionsCommand, } from "../commands/ListDurableExecutionsCommand";
import { LambdaClient } from "../LambdaClient";
export const paginateListDurableExecutions = createPaginator(LambdaClient, ListDurableExecutionsCommand, "Marker", "NextMarker", "MaxItems");
