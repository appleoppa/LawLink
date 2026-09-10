"use client";

/**
 * v0.50: 提醒推送（企业微信 / 钉钉群机器人）配置卡片。
 * 每日 09:00 到期扫描产生新提醒时，向机器人推一条汇总消息。
 */
import { useState, useTransition } from "react";
import { Loader2, Send, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  saveWebhookSettingsAction,
  sendTestWebhookAction
} from "@/server/settings/webhook-actions";

export function WebhookSettingsCard({
  initialEnabled,
  initialUrl
}: {
  initialEnabled: boolean;
  initialUrl: string;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [url, setUrl] = useState(initialUrl);
  const [saving, startSaving] = useTransition();
  const [testing, startTesting] = useTransition();

  function save() {
    startSaving(async () => {
      try {
        await saveWebhookSettingsAction({ enabled, url: url.trim() });
        toast.success("推送配置已保存");
      } catch (err) {
        toast.error("保存失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  function test() {
    startTesting(async () => {
      try {
        await sendTestWebhookAction();
        toast.success("测试消息已发送，请到群里确认");
      } catch (err) {
        toast.error("测试失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Webhook className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <div className="text-sm font-medium">群机器人推送（企业微信 / 钉钉）</div>
      </div>
      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
        每日到期扫描发现新提醒时，向群机器人推送一条汇总（只含事项标题与案件编号，不含当事人详情）。
        在企业微信 / 钉钉群里添加「自定义机器人」，把 Webhook 地址粘贴到下方；
        钉钉机器人建议用「自定义关键词」安全设置并填 <code className="font-mono">LawLink</code>。
      </p>

      <div className="mt-3 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">机器人 Webhook 地址</Label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=... 或 https://oapi.dingtalk.com/robot/send?access_token=..."
            className="font-mono text-[12px]"
          />
        </div>
        <label className="flex items-center gap-2 text-[12.5px]">
          <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
          启用每日提醒推送
        </label>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={saving} className="h-8 gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            保存
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={test}
            disabled={testing}
            className="h-8 gap-1.5"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            发送测试消息
          </Button>
        </div>
      </div>
    </div>
  );
}
