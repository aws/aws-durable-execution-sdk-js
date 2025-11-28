import { CheckpointWorker } from "./worker/checkpoint-worker";
import { parentPort } from "node:worker_threads";

// Initialize the worker when running in worker thread context
if (parentPort) {
  const worker = new CheckpointWorker(parentPort);
  worker.initialize();
}
