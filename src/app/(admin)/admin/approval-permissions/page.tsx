import { getPermissionAdministration } from "@/server/approval-permissions/actions";
import { PermissionAdministration } from "./permissions-view";

export default async function ApprovalPermissionsPage() {
  return <PermissionAdministration data={await getPermissionAdministration()} />;
}
