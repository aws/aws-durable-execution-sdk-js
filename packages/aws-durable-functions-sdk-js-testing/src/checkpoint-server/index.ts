import { CheckpointServerWorker } from "./worker/checkpoint-server-worker";
import { parentPort } from "worker_threads";

// Initialize the worker when running in worker thread context
if (parentPort) {
  const worker = new CheckpointServerWorker(parentPort);
  worker.initialize().catch((err: unknown) => {
    console.error("Error initializing the worker: ", err);
    process.exit(1);
  });
}
