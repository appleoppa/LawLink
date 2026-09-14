import type { MatterCategory } from "@prisma/client";
import { requireSystemAdmin } from "@/lib/auth/session";
import { matterCategoryLabel } from "@/lib/enums";
import { getFirmProfile, CATEGORY_ABBR, CATEGORY_WORD_DEFAULTS } from "@/server/settings/firm-profile";
import { getWorkflowToggles } from "@/server/settings/workflow-toggles";
import { FirmProfileForm } from "./_components/firm-profile-form";
import { WorkflowTogglesCard } from "./_components/workflow-toggles-card";
import { AdminPageHeader } from "@/components/layout/admin-page-header";

export default async function FirmProfilePage() {
  await requireSystemAdmin();
  const [profile, toggles] = await Promise.all([getFirmProfile(), getWorkflowToggles()]);
  const categories = (Object.keys(CATEGORY_WORD_DEFAULTS) as MatterCategory[]).map((key) => ({
    key,
    label: matterCategoryLabel[key],
    abbr: CATEGORY_ABBR[key],
    word: profile.categoryWords[key]
  }));
  return (
    <div className="space-y-5">
      <AdminPageHeader title="律所信息" sub="律所品牌、系统内部编号与所内案号模板；编号规则只影响此后新建的案件。" />
      <FirmProfileForm initial={{
        firmName: profile.firmName,
        firmSubtitle: profile.firmSubtitle,
        logoDataUrl: profile.logoDataUrl,
        matterCodePrefix: profile.matterCodePrefix,
        firmShortName: profile.firmShortName,
        caseNoTemplate: profile.caseNoTemplate,
        categories
      }} />
      <WorkflowTogglesCard initialExternalContactReview={toggles.externalContactReview} />
    </div>
  );
}
