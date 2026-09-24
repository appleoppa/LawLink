import { listRoleDefinitions } from "@/server/roles/actions";
import { RolesView } from "./_components/roles-view";
import { prisma } from "@/lib/prisma";

export default async function RolesPage() {
  const data = await listRoleDefinitions();
  if (!data.ready) {
    return <div className="rounded-xl border bg-card p-6"><h2 className="text-lg font-semibold">角色管理待启用</h2><p className="mt-2 text-sm text-muted-foreground">完成数据库升级后即可新增岗位角色；现有岗位继续使用。</p></div>;
  }

  // M-2a（2026-09-20 C 批）：配置缺口持续可见——不是一次性向导，配置缺失期间常显警示
  const [financeRoleUsers, tailGrants, pendingReceipts] = await Promise.all([
    prisma.user.count({ where: { active: true, role: "FINANCE" } }),
    prisma.rolePermission.count({ where: { permissionKey: "finance.tail", scope: "ALL", role: { active: true } } }),
    prisma.feeEntry.count({ where: { type: "RECEIVED", confirmState: "PENDING" } })
  ]);
  // finance.confirm 持有者 = 内置财务岗 + 自定义角色显式授予
  const confirmGrantUsers = await prisma.user.count({
    where: { active: true, OR: [{ role: "FINANCE" }, { role: "CUSTOM", roleDefinition: { active: true, permissions: { some: { permissionKey: "finance.confirm", scope: "ALL" } } } }] }
  });
  const gaps: { level: "high" | "warn"; text: string }[] = [];
  if (pendingReceipts > 0 && financeRoleUsers + confirmGrantUsers === 0) {
    gaps.push({ level: "high", text: `当前有 ${pendingReceipts} 笔待确认实收，但全所没有任何持有「确认实收到账」资格的有效账号（内置财务岗或授权角色）——款项将无法计入实收与回款。请为合适人员配置财务岗或含 finance.confirm 的角色。` });
  }
  if (tailGrants === 0) {
    gaps.push({ level: "warn", text: "全所没有持有「归档后财务收尾」（finance.tail）资格的账号——带未结款项的案件在归档时将无法指定收尾负责人。建议按「独立执业」模板或显式授予。" });
  }

  return <RolesView roles={data.roles} builtins={data.builtins} gaps={gaps} />;
}