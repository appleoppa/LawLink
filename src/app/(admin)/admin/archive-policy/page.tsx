import { getArchivePolicySettings } from "@/server/archive/policy";
import { ArchivePolicyForm } from "./archive-policy-form";

export default async function ArchivePolicyPage() {
  return <ArchivePolicyForm data={await getArchivePolicySettings()} />;
}
