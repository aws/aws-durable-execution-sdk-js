import { LambdaClient } from "../LambdaClient";
import { ListDurableExecutionsCommand } from "../commands/ListDurableExecutionsCommand";
import { createPaginator } from "@smithy/core";
export const paginateListDurableExecutions = createPaginator(
  LambdaClient,
  ListDurableExecutionsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);
