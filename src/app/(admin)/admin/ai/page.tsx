import { getAiSettingsPublic } from "@/server/settings/ai-actions";
import { getYuandianSettingsPublic } from "@/server/settings/yuandian-actions";
import { AI_DEFAULTS } from "@/lib/ai/settings";
import { YUANDIAN_DEFAULTS } from "@/lib/yuandian/settings";
import { AiSettingsForm } from "./_components/ai-settings-form";
import { YuandianSettingsForm } from "./_components/yuandian-settings-form";

export default async function AiSettingsPage() {
  const [ai, yuandian] = await Promise.all([
    getAiSettingsPublic(),
    getYuandianSettingsPublic()
  ]);
  return (
    <div className="space-y-5">
      <AiSettingsForm initial={ai} defaults={AI_DEFAULTS} />
      <YuandianSettingsForm initial={yuandian} defaults={YUANDIAN_DEFAULTS} />
    </div>
  );
}
