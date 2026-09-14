import { getAiSettingsPublic } from "@/server/settings/ai-actions";
import { getYuandianSettingsPublic } from "@/server/settings/yuandian-actions";
import { AI_DEFAULTS } from "@/lib/ai/settings";
import { YUANDIAN_DEFAULTS } from "@/lib/yuandian/settings";
import { AiSettingsForm } from "./_components/ai-settings-form";
import { YuandianSettingsForm } from "./_components/yuandian-settings-form";
import { getExternalCallStats } from "@/server/settings/external-call-stats";
import { ExternalCallStatsCard } from "./_components/external-call-stats-card";
import { AdminPageHeader } from "@/components/layout/admin-page-header";

export default async function AiSettingsPage() {
  const [ai, yuandian, callStats] = await Promise.all([
    getAiSettingsPublic(),
    getYuandianSettingsPublic(),
    getExternalCallStats()
  ]);
  return (
    <div className="space-y-5">
      <AdminPageHeader title="AI 与元典" sub="配置 OpenAI 兼容模型与元典法律数据接口；密钥加密保存，前端永不显示明文。" />
      <AiSettingsForm initial={ai} defaults={AI_DEFAULTS} />
      <YuandianSettingsForm initial={yuandian} defaults={YUANDIAN_DEFAULTS} />
      <ExternalCallStatsCard stats={callStats} />
    </div>
  );
}
