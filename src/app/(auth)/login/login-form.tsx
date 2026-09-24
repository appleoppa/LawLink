"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, AlertCircle, Mail, LockKeyhole, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkLoginTotpEnforcement } from "@/server/auth/totp-actions";

const schema = z.object({
  email: z.string().email("请填写有效邮箱"),
  password: z.string().min(1, "请填写密码"),
  totpCode: z.string().optional()
});

type FormValues = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const [authError, setAuthError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showTotp, setShowTotp] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({
    resolver: zodResolver(schema)
  });

  async function onSubmit(values: FormValues) {
    setAuthError(null);
    const res = await signIn("credentials", {
      email: values.email,
      password: values.password,
      totpCode: values.totpCode || undefined,
      redirect: false
    });
    if (res?.ok) {
      router.replace(callbackUrl);
      router.refresh();
    } else {
      if (res?.error !== "CredentialsSignin") {
        setAuthError("登录服务暂时异常，请稍后重试或联系管理员；这不代表密码错误。");
        return;
      }
      // 凭据被拒时区分策略性拦截：被管理员要求开启双步验证但尚未绑定的账号
      // 在完成绑定前无法登录（authorize 恒拒）。仅在已失败后查询，避免账号探测。
      try {
        const enforced = await checkLoginTotpEnforcement(values.email);
        if (enforced) {
          setAuthError("该账号已被管理员要求开启双步验证，且尚未完成绑定，暂无法登录。请联系管理员协助完成绑定。");
          return;
        }
      } catch {
        // 预检不可用时不影响通用错误提示
      }
      setAuthError(showTotp ? "邮箱、密码或两步验证码错误" : "邮箱或密码错误；如账号已开启两步验证，请勾选「使用两步验证码」后填写。");
    }
  }

  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
      {authError ? (
        <div role="alert" className="mb-4 flex gap-2 rounded-[10px] border border-[var(--red-line)] bg-[var(--red-bg)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--red)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{authError}</span>
        </div>
      ) : null}

      <div className="fp-field">
        <label htmlFor="email" className="fp-label">邮箱</label>
        <div className={cn("fp-input", errors.email && "!border-[var(--red)]")}>
          <Mail aria-hidden />
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="name@firm.cn"
            aria-invalid={!!errors.email}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-[var(--t-primary)] outline-none placeholder:text-[var(--t-faint)]"
            {...register("email")}
          />
        </div>
        {errors.email ? <p className="mt-1.5 text-[11.5px] text-[var(--red)]">{errors.email.message}</p> : null}
      </div>

      <div className="fp-field">
        <label htmlFor="password" className="fp-label">密码</label>
        <div className={cn("fp-input", errors.password && "!border-[var(--red)]")}>
          <LockKeyhole aria-hidden />
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-[var(--t-primary)] outline-none"
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
            className="ml-auto shrink-0 border-0 bg-transparent text-[12px] text-[var(--t-faint)] hover:text-[var(--t-secondary)]"
          >
            {showPassword ? "隐藏" : "显示"}
          </button>
        </div>
        {errors.password ? <p className="mt-1.5 text-[11.5px] text-[var(--red)]">{errors.password.message}</p> : null}
      </div>

      {showTotp ? (
        <div className="fp-field">
          <label htmlFor="totpCode" className="fp-label">两步验证码</label>
          <div className="fp-input">
            <ShieldCheck aria-hidden />
            <input
              id="totpCode"
              inputMode="numeric"
              maxLength={16}
              autoFocus
              placeholder="6 位动态码或恢复码"
              autoComplete="one-time-code"
              className="h-full min-w-0 flex-1 border-0 bg-transparent font-mono text-[13.5px] tracking-[0.08em] text-[var(--t-primary)] outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-[var(--t-faint)]"
              {...register("totpCode")}
            />
          </div>
        </div>
      ) : null}

      <div className="fp-row">
        <button type="button" onClick={() => setShowTotp((v) => !v)} className="fp-check border-0 bg-transparent p-0 font-[inherit]" aria-expanded={showTotp}>
          <span className={cn("fp-box", !showTotp && "!border !border-[var(--bd-strong)] !bg-card")}>
            {showTotp ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" aria-hidden>
                <path d="M4 12.5l5 5L20 7" />
              </svg>
            ) : null}
          </span>
          使用两步验证码
        </button>
        <span className="fp-link" title="本系统为自部署实例，密码由所内管理员在管理后台重置">忘记密码？请联系管理员</span>
      </div>

      <button type="submit" className="btn btn-primary btn-login" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null}
        {isSubmitting ? "登录中…" : "登 录"}
      </button>
    </form>
  );
}
