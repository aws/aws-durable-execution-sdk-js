// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { handler as lifecycle, observeInvocation } from "./fixture.mjs";
import { handlers } from "./build/registry.mjs";
import { routeExample } from "./routing.mjs";

export function handler(event, context) {
  const route = routeExample(event, handlers);
  return route
    ? observeInvocation(route.event, context, route.handler, route.metadata)
    : lifecycle(event, context);
}
