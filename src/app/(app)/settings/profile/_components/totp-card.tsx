"use client";

/**
 * TOTP 双步验证绑定/关闭卡（个人设置 · 登录安全）。
 * 绑定流程：生成密钥（展示 otpauth URI 与手输密钥）→ 输入 6 位动态码确认
 * → 一次性展示 8 枚恢复码（仅此一次，请妥善保存）。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { enrollStartTotp, enrollConfirmTotp, disableTotp } from "@/server/auth/totp-actions";

export function TotpCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enrolling, setEnrolling] = useState(false);
  const [secretInfo, setSecretInfo] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [showDisable, setShowDisable] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  function start() {
    startTransition(async () => {
      try {
        setSecretInfo(await enrollStartTotp());
        setEnrolling(true);
        setCode("");
        setRecoveryCodes(null);
      } catch (e) {
        toast.error("生成密钥失败", { description: e instanceof Error ? e.message : "" });
      }
    });
  }

  function confirm() {
    if (!/^\d{6}$/.test(code.trim())) {
      toast.error("请输入 6 位动态码");
      return;
    }
    startTransition(async () => {
      try {
        const res = await enrollConfirmTotp({ code: code.trim() });
        if (!res.ok) {
          toast.error("验证失败", { description: res.message });
          return;
        }
        setRecoveryCodes(res.recoveryCodes);
        setEnrolling(false);
        setSecretInfo(null);
        setCode("");
        toast.success("双步验证已开启");
        router.refresh();
      } catch (e) {
        toast.error("确认失败", { description: e instanceof Error ? e.message : "" });
      }
    });
  }

  function turnOff() {
    startTransition(async () => {
      try {
        const res = await disableTotp({ code: disableCode.trim() });
        if (!res.ok) {
          toast.error("关闭失败", { description: res.message });
          return;
        }
        setShowDisable(false);
        setDisableCode("");
        toast.success("双步验证已关闭");
        router.refresh();
      } catch (e) {
        toast.error("关闭失败", { description: e instanceof Error ? e.message : "" });
      }
    });
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            {enabled ? (
              <ShieldCheck className="h-4 w-4 text-primary" />
            ) : (
              <ShieldOff className="h-4 w-4 text-muted-foreground" />
            )}
            双步验证（动态码）
            {enabled && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10.5px] text-primary">已开启</span>}
          </div>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
            {enabled
              ? "登录时需输入验证器 App 的 6 位动态码或恢复码，为账号增加第二道防线。"
              : "开启后登录需动态码二次验证（支持各类验证器 App），防止密码泄露导致的账号被盗。"}
          </p>
        </div>
        {!enrolling && !recoveryCodes && !enabled && (
          <button
            onClick={start}
            disabled={pending}
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            开启双步验证
          </button>
        )}
        {enabled && !showDisable && (
          <button
            onClick={() => setShowDisable(true)}
            disabled={pending}
            className="shrink-0 rounded-md border px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-accent"
          >
            关闭
          </button>
        )}
      </div>

      {enrolling && secretInfo && (
        <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
          <div>
            <div className="text-[12.5px] font-medium">第 1 步：在验证器 App 中添加密钥</div>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              扫码或手动输入以下密钥（Google Authenticator / Microsoft Authenticator / 1Password 等均支持）：
            </p>
            <div className="mt-1.5 select-all break-all rounded border bg-background px-2 py-1.5 font-mono text-[11.5px]">
              {secretInfo.secret}
            </div>
            <div className="mt-1 select-all break-all text-[10.5px] text-muted-foreground">{secretInfo.uri}</div>
          </div>
          <div>
            <div className="text-[12.5px] font-medium">第 2 步：输入 App 显示的 6 位动态码确认</div>
            <div className="mt-1.5 flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="000000"
                className="w-32 rounded-md border bg-background px-2 py-1.5 font-mono text-[13px] tracking-widest"
              />
              <button
                onClick={confirm}
                disabled={pending || code.length !== 6}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[12.5px] text-primary-foreground disabled:opacity-50"
              >
                {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                确认并开启
              </button>
              <button onClick={() => { setEnrolling(false); setSecretInfo(null); }} className="rounded-md border px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:bg-accent">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {recoveryCodes && (
        <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "#EBD8AB", background: "#FAF0DB" }}>
          <div className="text-[12.5px] font-medium" style={{ color: "#96650B" }}>
            恢复码（仅此一次展示）
          </div>
          <p className="mt-0.5 text-[11.5px] leading-4" style={{ color: "#68747F" }}>
            动态码无法使用时（换机/丢失），可用以下任一恢复码登录，每枚只能使用一次。请抄写或打印保存。
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
            {recoveryCodes.map((c) => (
              <span key={c} className="select-all rounded border bg-white px-2 py-1 text-center font-mono text-[12px]" style={{ borderColor: "#E6D9C0" }}>
                {c}
              </span>
            ))}
          </div>
          <button onClick={() => setRecoveryCodes(null)} className="mt-2 rounded-md border px-2.5 py-1 text-[12px]" style={{ borderColor: "#DDE3E0" }}>
            我已妥善保存
          </button>
        </div>
      )}

      {showDisable && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/40 p-3">
          <input
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value.trim())}
            placeholder="输入动态码或恢复码以关闭"
            className="w-56 rounded-md border bg-background px-2 py-1.5 font-mono text-[12.5px]"
          />
          <button
            onClick={turnOff}
            disabled={pending || disableCode.length < 6}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[12.5px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}
            确认关闭
          </button>
          <button onClick={() => { setShowDisable(false); setDisableCode(""); }} className="text-[12.5px] text-muted-foreground hover:text-foreground">
            取消
          </button>
        </div>
      )}
    </div>
  );
}
