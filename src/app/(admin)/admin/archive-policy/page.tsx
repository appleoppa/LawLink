import { getArchivePolicySettings } from "@/server/archive/policy";
import { ArchivePolicyForm } from "./archive-policy-form";
import { AdminPageHeader } from "@/components/layout/admin-page-header";

export default async function ArchivePolicyPage() {
  return (
    <div className="space-y-5">
      <AdminPageHeader title="归档制度" sub="关联本所现行归档制度后，律师才能提交正式归档申请。" />
      <ArchivePolicyForm data={await getArchivePolicySettings()} />
    </div>
  );
}
