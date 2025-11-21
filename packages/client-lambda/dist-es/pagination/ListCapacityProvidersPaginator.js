import { createPaginator } from "@smithy/core";
import { ListCapacityProvidersCommand } from "../commands/ListCapacityProvidersCommand";
import { LambdaClient } from "../LambdaClient";
export const paginateListCapacityProviders = createPaginator(
  LambdaClient,
  ListCapacityProvidersCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);
