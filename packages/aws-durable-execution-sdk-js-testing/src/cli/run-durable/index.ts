#!/usr/bin/env node

import { runDurable, RunDurableError } from "./run-durable";

// Entry point
runDurable().catch((err: unknown) => {
  if (err instanceof RunDurableError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
