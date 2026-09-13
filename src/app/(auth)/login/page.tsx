import { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { Check, Loader2 } from "lucide-react";

export const metadata: Metadata = {
  title: "登录 — LawLink"
};

/** 墨案 01 效果图：品牌面板卖点 */
const POINTS = [
  "收案即冲突检索，主体身份自动携带",
  "法定期限规则推算，阶梯预警不漏项",
  "材料来源可溯，审阅与用印全程留痕"
];

export default function LoginPage() {
  return (
    <div className="grid w-full max-w-5xl grid-cols-1 gap-0 lg:grid-cols-2">
      {/* 左侧：品牌面板（墨案 01 效果图：navy 渐变 + teal 光晕 + 宋体主张） */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden rounded-l-lg border border-r-0 border-border p-10 lg:flex"
        style={{ background: "linear-gradient(165deg, #142C48 0%, #10233A 42%, #0C1927 100%)" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(460px 460px at 82% -8%, rgba(0,166,166,0.22) 0%, rgba(0,166,166,0) 62%), radial-gradient(480px 480px at -12% 108%, rgba(0,123,127,0.14) 0%, rgba(0,123,127,0) 60%)"
          }}
        />
        <div className="relative z-[1] flex items-center gap-3">
          {/* 正式标志（双立柱 + teal 连接件，见 docs/BRAND.md） */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/lawlink-mark.svg" alt="LawLink" className="h-9 w-9 rounded-[10px]" />
          <div>
            <div className="text-lg font-semibold tracking-tight text-white">LawLink</div>
            <div className="mt-0.5 text-[11px] text-white/55">律所案件管理系统 · 自部署</div>
          </div>
        </div>

        <div className="relative z-[1] max-w-[480px]">
          <div className="mb-5 text-[11px] font-semibold tracking-[0.22em] text-[#5EC7C4]">
            LAWLINK · 案卷工作台
          </div>
          <h2
            className="text-[34px] font-bold leading-[1.4] tracking-[0.02em] text-white"
            style={{ fontFamily: '"Songti SC", "STSong", "Noto Serif SC", serif' }}
          >
            让每一件案件，
            <br />
            都<span style={{ color: "#4FC3C0" }}>有迹可循</span>。
          </h2>
          <p className="mt-5 text-[14px] leading-[1.85] text-white/60">
            从收案登记、冲突检索到程序推进、结案归档——案件、材料、期限与财务在同一卷宗里各就其位，来源可溯，责任可查。
          </p>
          <ul className="mt-8 flex flex-col gap-3.5">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3 text-[13px] text-white/80">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border text-[#4FC3C0]"
                  style={{ background: "rgba(0,166,166,0.14)", borderColor: "rgba(0,166,166,0.28)" }}
                >
                  <Check className="h-3 w-3" strokeWidth={2.4} />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-[1] flex items-center justify-between text-[11.5px] text-white/40">
          <span>自部署 · 单所实例 · 数据完全自托管</span>
          <span>MIT 协议 · 开源</span>
        </div>
      </div>

      {/* 右侧：登录卡（墨案 01 效果图：标题 + 登录保护提示） */}
      <div className="flex flex-col justify-center rounded-lg border border-border bg-card p-10 lg:rounded-l-none">
        <div className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">登录 LawLink</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">使用你的工作账号进入本所工作台</p>
        </div>

        <Suspense fallback={<LoginFallback />}>
          <LoginForm />
        </Suspense>

        <div className="mt-6 flex gap-2 rounded-[10px] border border-border bg-muted/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          <span
            aria-hidden
            className="mt-[3px] inline-block h-[7px] w-[7px] shrink-0 rounded-full"
            style={{ background: "#007B7F" }}
          />
          登录保护已开启：连续 5 次失败将临时锁定 15 分钟；管理员可要求两步验证。登录行为记录审计。
        </div>
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
