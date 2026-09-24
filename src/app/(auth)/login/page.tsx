import { Metadata } from "next";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { getFirmProfile } from "@/server/settings/firm-profile";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "登录 — LawLink"
};

/** 墨案 01 效果图：左侧深墨品牌面板 + 右侧表单面板，全屏分栏 */
export default async function LoginPage() {
  const profile = await getFirmProfile().catch(() => null);
  const firmName = profile?.firmName && profile.firmName !== "LawLink" ? profile.firmName : null;

  return (
    <div className="mo-login">
      <div className="login">
        <div className="brand-panel">
          <div className="bp-brand">
            <div className="bp-mark">
              <svg width="19" height="19" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="3" y="2.6" width="2.7" height="10.8" rx="1.1" fill="#fff" />
                <rect x="8.4" y="2.6" width="2.7" height="10.8" rx="1.1" fill="#fff" />
                <rect x="3" y="6.8" width="8.1" height="2.4" rx="1.1" fill="#00A6A6" />
              </svg>
            </div>
            <div>
              <div className="bp-name">LawLink</div>
              <div className="bp-sub">律所案件管理系统 · 自部署</div>
            </div>
          </div>

          <div className="bp-hero">
            <div className="bp-eyebrow">LAWLINK · 案卷工作台</div>
            <h1 className="bp-title">
              让每一件案件，
              <br />
              都<span className="hl">有迹可循</span>。
            </h1>
            <p className="bp-desc">从收案登记、冲突检索到程序推进、结案归档——案件、材料、期限与财务在同一卷宗里各就其位，来源可溯，责任可查。</p>
            <div className="bp-points">
              <div className="bp-point">
                <div className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M9 12l2 2 4-5" />
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                </div>
                收案即冲突检索，主体身份自动携带
              </div>
              <div className="bp-point">
                <div className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M12 3l7 4v5c0 4.4-3 8-7 9-4-1-7-4.6-7-9V7z" />
                  </svg>
                </div>
                法定期限规则推算，阶梯预警不漏项
              </div>
              <div className="bp-point">
                <div className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                    <path d="M14 3v6h6" />
                  </svg>
                </div>
                材料来源可溯，审阅与用印全程留痕
              </div>
            </div>
          </div>

          <div className="bp-foot">
            <span>{firmName ? `${firmName} · 专属实例` : "自部署 · 单所实例 · 数据自托管"}</span>
            <span>MIT License</span>
          </div>
        </div>

        <div className="form-panel">
          <div className="fp-body">
            <h2 className="fp-title">登录 LawLink</h2>
            <p className="fp-sub">使用你的工作账号进入本所工作台</p>
            <Suspense fallback={<LoginFallback />}>
              <LoginForm />
            </Suspense>
            <div className="fp-protect">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M12 3l7 4v5c0 4.4-3 8-7 9-4-1-7-4.6-7-9V7z" />
                <path d="M12 11v4M12 8h.01" />
              </svg>
              <span>登录保护已开启：连续 5 次失败将临时锁定 15 分钟；管理员可要求两步验证。</span>
            </div>
          </div>
          <div className="fp-foot">
            遇到登录问题请联系所内管理员<span className="sep">·</span>登录行为将被记录审计
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="flex h-56 items-center justify-center text-[var(--t-muted)]">
      <Loader2 className="h-4 w-4 animate-spin" />
    </div>
  );
}
