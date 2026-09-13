import { listRoleDefinitions } from "@/server/roles/actions";
import { RolesView } from "./_components/roles-view";

export default async function RolesPage() {
  const data = await listRoleDefinitions();
  if (!data.ready) {
    return <div className="rounded-xl border bg-card p-6"><h2 className="text-lg font-semibold">角色管理待启用</h2><p className="mt-2 text-sm text-muted-foreground">完成数据库升级后即可新增岗位角色；现有岗位继续使用。</p></div>;
  }
  return <RolesView roles={data.roles} builtins={data.builtins} />;
}
