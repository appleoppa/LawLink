import { listCustomFieldDefs } from "@/server/custom-fields/actions";
import { requireSystemAdmin } from "@/lib/auth/session";
import { CustomFieldsView } from "./_components/custom-fields-view";

export default async function CustomFieldsPage() {
  await requireSystemAdmin();
  return <CustomFieldsView matterFields={await listCustomFieldDefs("MATTER")} />;
}
