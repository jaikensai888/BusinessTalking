/**
 * Next.js 服务器实例启动钩子（P0-C）：恢复上次进程中断的讨论。
 * register 在服务器就绪前执行一次；恢复本身 fire-and-forget，不阻塞启动。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as typeof globalThis & { __btRecoveryStarted?: boolean };
  if (g.__btRecoveryStarted) return;
  g.__btRecoveryStarted = true;
  try {
    const { recoverStaleRunningDiscussions } = await import("@/lib/discussion/recovery");
    const resumed = await recoverStaleRunningDiscussions();
    if (resumed.length) console.log("[recovery] 已从断点恢复讨论：", resumed.join(", "));
  } catch (error) {
    console.error("[recovery] 讨论恢复失败：", error instanceof Error ? error.message : String(error));
  }
}
