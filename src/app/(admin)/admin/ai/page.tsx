import { getAiSettingsPublic } from "@/server/settings/ai-actions";
import { getYuandianSettingsPublic } from "@/server/settings/yuandian-actions";
import { AI_DEFAULTS } from "@/lib/ai/settings";
import { YUANDIAN_DEFAULTS } from "@/lib/yuandian/settings";
import { AiSettingsForm } from "./_components/ai-settings-form";
import { YuandianSettingsForm } from "./_components/yuandian-settings-form";
import { getExternalCallStats } from "@/server/settings/external-call-stats";
import { ExternalCallStatsCard } from "./_components/external-call-stats-card";

export default async function AiSettingsPage() {
  const [ai, yuandian, callStats] = await Promise.all([
    getAiSettingsPublic(),
    getYuandianSettingsPublic(),
    getExternalCallStats()
  ]);
  return (
    <div className="space-y-5">
      <AiSettingsForm initial={ai} defaults={AI_DEFAULTS} />
      <YuandianSettingsForm initial={yuandian} defaults={YUANDIAN_DEFAULTS} />
      <ExternalCallStatsCard stats={callStats} />
    </div>
  );
}
