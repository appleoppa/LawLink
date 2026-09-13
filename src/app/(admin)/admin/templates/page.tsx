import { listStageTemplates } from "@/server/settings/actions";
import { TemplatesView } from "./_components/templates-view";

export default async function TemplatesPage() {
  return <TemplatesView templates={await listStageTemplates()} />;
}
