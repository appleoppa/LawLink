/**
 * LawLink standalone cron worker.
 *
 * This process owns node-cron timers separately from next-server. Keeping the
 * scheduler out of the HTTP process prevents a blocked request/build path from
 * delaying node-cron heartbeats and silently skipping a slot.
 */
import { registerCronJobs } from "./scheduler";

type ProcessLike = {
  exit(code: number): never;
  once(signal: string, handler: () => void): void;
};

const nodeProcess = (globalThis as unknown as { process: ProcessLike }).process;

console.log("[cron-worker] starting standalone LawLink scheduler");
registerCronJobs();

function shutdown(signal: string) {
  console.log(`[cron-worker] received ${signal}; stopping`);
  nodeProcess.exit(0);
}

nodeProcess.once("SIGTERM", () => shutdown("SIGTERM"));
nodeProcess.once("SIGINT", () => shutdown("SIGINT"));