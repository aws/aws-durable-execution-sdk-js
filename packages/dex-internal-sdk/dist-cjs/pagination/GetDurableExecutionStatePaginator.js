"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginateGetDurableExecutionState = void 0;
const LambdaClient_1 = require("../LambdaClient");
const GetDurableExecutionStateCommand_1 = require("../commands/GetDurableExecutionStateCommand");
const core_1 = require("@smithy/core");
exports.paginateGetDurableExecutionState = (0, core_1.createPaginator)(
  LambdaClient_1.LambdaClient,
  GetDurableExecutionStateCommand_1.GetDurableExecutionStateCommand,
  "Marker",
  "NextMarker",
  "MaxItems",
);
