import { requireSystemAdmin } from "@/lib/auth/session";
import { listTemplatesForAdmin } from "@/server/document-templates/actions";
import { DocumentTemplatesView } from "./_components/document-templates-view";

export default async function DocumentTemplatesPage() {
  await requireSystemAdmin();
  const templates = await listTemplatesForAdmin();
  return (
    <DocumentTemplatesView
      templates={templates.map(t => ({
        ...t,
        variables: Array.isArray(t.variables) ? (t.variables as string[]) : [],
        updatedAt: t.updatedAt.toISOString()
      }))}
    />
  );
}
