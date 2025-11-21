import { createPaginator } from "@smithy/core";
import { ListFunctionVersionsByCapacityProviderCommand } from "../commands/ListFunctionVersionsByCapacityProviderCommand";
import { LambdaClient } from "../LambdaClient";
export const paginateListFunctionVersionsByCapacityProvider = createPaginator(
  LambdaClient,
  ListFunctionVersionsByCapacityProviderCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);
