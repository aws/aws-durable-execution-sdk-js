"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginateListDurableExecutions = void 0;
const LambdaClient_1 = require("../LambdaClient");
const ListDurableExecutionsCommand_1 = require("../commands/ListDurableExecutionsCommand");
const core_1 = require("@smithy/core");
exports.paginateListDurableExecutions = (0, core_1.createPaginator)(
  LambdaClient_1.LambdaClient,
  ListDurableExecutionsCommand_1.ListDurableExecutionsCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);
