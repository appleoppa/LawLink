import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canEnterAdminWorkspace } from "@/lib/auth/system-role";
import { MatterImportView } from "./_components/matter-import-view";
import { AdminPageHeader } from "@/components/layout/admin-page-header";

export default async function MatterImportPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  if (!canEnterAdminWorkspace(session.user)) redirect("/settings/profile");
  return (
    <div className="space-y-5">
      <AdminPageHeader title="批量导入" sub="下载模板填写后上传预览，校验通过再确认导入；导入会同步建档客户并触发冲突检索。" />
      <MatterImportView />
    </div>
  );
}
