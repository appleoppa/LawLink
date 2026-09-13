import { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { Scale, ShieldCheck, Sparkles, Loader2 } from "lucide-react";

export const metadata: Metadata = {
  title: "登录 — LawLink"
};

export default function LoginPage() {
  return (
    <div className="grid w-full max-w-5xl grid-cols-1 gap-0 lg:grid-cols-2">
      {/* 左侧：品牌区 */}
      {/* 墨案批次⑥（01 效果图）：左品牌面板 navy 渐变 + teal 辐射光晕；宋体仅用于品牌主张 */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden rounded-l-lg border border-r-0 border-border p-10 lg:flex"
        style={{ background: "linear-gradient(160deg, #142C48 0%, #0C1927 100%)" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(420px 300px at 78% 18%, rgba(0,166,166,0.28) 0%, rgba(0,166,166,0) 62%)"
          }}
        />
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Scale className="h-4 w-4" strokeWidth={1.8} />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight text-white">LawLink</div>
            <div className="mt-0.5 text-[11px] text-white/55">律师工作台</div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="space-y-4">
            <div className="text-xs text-[#7FD1CF]">{new Date().getFullYear()}</div>
            <h2
              className="text-2xl font-semibold leading-snug tracking-tight text-white"
              style={{ fontFamily: '"Songti SC", "STSong", "Noto Serif SC", serif' }}
            >
              把精力放在案件本身，
              <br />
              而不是表格里。
            </h2>
            <div className="h-[2px] w-8 rounded-full bg-[#00A6A6]" />
          </div>

          <ul className="space-y-3.5 text-sm text-white/60">
            <Feature icon={<ShieldCheck className="h-3.5 w-3.5" />}>
              数据自托管，附件可选加密，不依赖第三方托管服务
            </Feature>
            <Feature icon={<Sparkles className="h-3.5 w-3.5" />}>
              覆盖收案、冲突检索、多程序串接、财务分成、归档全流程
            </Feature>
            <Feature icon={<Scale className="h-3.5 w-3.5" />}>
              规范案由库（民商事 / 刑事 / 行政）从源头消除字符串歧义
            </Feature>
          </ul>
        </div>

        <div className="text-[11px] text-white/60/70">
          MIT 协议 · 自主部署
        </div>
      </div>

      {/* 右侧：登录卡 */}
      <div className="flex flex-col justify-center rounded-lg border border-border bg-card p-10 lg:rounded-l-none">
        <div className="mb-8">
          <div className="text-xs text-muted-foreground">登录</div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">欢迎回来</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            用您的工作邮箱登录
          </p>
        </div>

        <Suspense fallback={<LoginFallback />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="flex h-40 items-center justify-center text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
    </div>
  );
}

function Feature({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}
