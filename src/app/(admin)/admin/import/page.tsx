import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canEnterAdminWorkspace } from "@/lib/auth/system-role";
import { MatterImportView } from "./_components/matter-import-view";

export default async function MatterImportPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  if (!canEnterAdminWorkspace(session.user)) redirect("/settings/profile");
  return <MatterImportView />;
}
