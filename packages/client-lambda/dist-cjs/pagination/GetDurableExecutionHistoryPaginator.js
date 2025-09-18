"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginateGetDurableExecutionHistory = void 0;
const LambdaClient_1 = require("../LambdaClient");
const GetDurableExecutionHistoryCommand_1 = require("../commands/GetDurableExecutionHistoryCommand");
const core_1 = require("@smithy/core");
exports.paginateGetDurableExecutionHistory = (0, core_1.createPaginator)(LambdaClient_1.LambdaClient, GetDurableExecutionHistoryCommand_1.GetDurableExecutionHistoryCommand, "Marker", "NextMarker", "MaxItems");
