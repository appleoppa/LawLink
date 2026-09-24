import { getPermissionAdministration } from "@/server/approval-permissions/actions";
import { getSelfConfirmListAdmin } from "@/server/approval-permissions/self-confirm-actions";
import { SelfConfirmCard } from "./_components/self-confirm-card";
import { PermissionAdministration } from "./permissions-view";

export default async function ApprovalPermissionsPage() {
  const [data, selfConfirm] = await Promise.all([
    getPermissionAdministration(),
    getSelfConfirmListAdmin()
  ]);
  return (
    <div className="space-y-5">
      <PermissionAdministration data={data} />
      <SelfConfirmCard initialActions={selfConfirm.items.map(i => i.action)} />
    </div>
  );
}
