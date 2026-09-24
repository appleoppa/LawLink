import { listUsers } from "@/server/users/actions";
import { listRoleDefinitions } from "@/server/roles/actions";
import { requireSystemAdmin } from "@/lib/auth/session";
import { UsersView } from "./_components/users-view";

export default async function UsersPage() {
  const session = await requireSystemAdmin();
  const [users, definitions] = await Promise.all([listUsers(), listRoleDefinitions()]);
  return <UsersView builtinNames={Object.fromEntries(definitions.builtins.map(role => [role.id, role.name]))} customRoles={definitions.roles.map(role => ({ id: role.id, name: role.name, active: role.active }))} users={users} currentUserId={session.user.id} />;
}
