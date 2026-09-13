/**
 * Next.js instrumentation hook：进程启动时一次性副作用注册。
 *
 * 当前唯一职责：注册 cron 定时作业（仅生产 / nodejs runtime）。
 * dev 模式跳过，避免开发时误推真实通知。
 *
 * Node.js 运行时内动态加载调度器，让生产构建包含依赖并隔离 Edge 运行时。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.DISABLE_CRON === "1") return;

  const { registerCronJobs } = await import("./server/cron/scheduler");
  registerCronJobs();
}
