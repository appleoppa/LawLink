"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { myProfileSchema } from "@/server/users/profile-schema";
import { updateMyProfile } from "@/server/users/profile-actions";
import { updateUserProfile } from "@/server/users/actions";

type Values = z.infer<typeof myProfileSchema>;
export type BasicProfile = { name: string; email: string; phone: string | null; updatedAt: string };
export function ProfileBasicsForm({ profile, adminTargetId, isSelf = true, onSaved, layout = "grid", extraFields }: {
  profile: BasicProfile; adminTargetId?: string; isSelf?: boolean; onSaved?: () => void;
  /** grid＝双列栅格（管理后台）；stacked＝单列纵排（个人设置头像旁） */
  layout?: "grid" | "stacked";
  /** 追加在字段之后、操作按钮之前的字段行（如证件号码）；不得包含 <form> */
  extraFields?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showPhone, setShowPhone] = useState(false);
  const { register, handleSubmit, control, resetField, setValue, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(myProfileSchema),
    defaultValues: { name: profile.name, email: profile.email, phone: undefined, expectedUpdatedAt: profile.updatedAt, currentPassword: "" }
  });
  const emailChanged = useWatch({ control, name: "email" }).trim() !== profile.email;
  const prefix = adminTargetId ?? "my-profile";
  function submit(values: Values) {
    start(async () => {
      try {
        const result = adminTargetId
          ? await updateUserProfile({ id: adminTargetId, ...values })
          : await updateMyProfile(values);
        resetField("currentPassword");
        if (result.emailChanged && isSelf) {
          toast.success("邮箱已更新，请使用新邮箱重新登录");
          await signOut({ callbackUrl: "/login" });
          return;
        }
        toast.success(result.emailChanged ? "资料已更新，该账号需使用新邮箱重新登录" : "个人资料已保存");
        setShowPhone(false);
        onSaved?.();
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "资料保存失败");
      }
    });
  }
  return <form noValidate onSubmit={handleSubmit(submit)} className="space-y-4">
    <fieldset disabled={pending} className={layout === "stacked" ? "space-y-4" : "grid gap-4 md:grid-cols-2"}>
      {layout === "stacked" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor={`${prefix}-name`}>姓名</Label><Input id={`${prefix}-name`} autoComplete="name" {...register("name")} aria-invalid={!!errors.name} />{errors.name && <p role="alert" className="text-xs text-destructive">{errors.name.message}</p>}</div>
          <div className="space-y-2"><Label htmlFor={`${prefix}-email`}>邮箱（登录账号）</Label><Input id={`${prefix}-email`} type="email" autoComplete="email" {...register("email")} aria-invalid={!!errors.email} />{errors.email && <p role="alert" className="text-xs text-destructive">{errors.email.message}</p>}</div>
        </div>
      ) : (<>
        <div className="space-y-2"><Label htmlFor={`${prefix}-name`}>姓名</Label><Input id={`${prefix}-name`} autoComplete="name" {...register("name")} aria-invalid={!!errors.name} />{errors.name && <p role="alert" className="text-xs text-destructive">{errors.name.message}</p>}</div>
        <div className="space-y-2"><Label htmlFor={`${prefix}-email`}>邮箱（登录账号）</Label><Input id={`${prefix}-email`} type="email" autoComplete="email" {...register("email")} aria-invalid={!!errors.email} />{errors.email && <p role="alert" className="text-xs text-destructive">{errors.email.message}</p>}</div>
      </>)}
      <div className="space-y-2"><Label htmlFor={showPhone ? `${prefix}-phone` : undefined}>手机号</Label>
        {showPhone ? <><Input id={`${prefix}-phone`} type="tel" autoComplete="tel" {...register("phone")} aria-invalid={!!errors.phone} /><Button type="button" size="sm" variant="ghost" onClick={() => { resetField("phone"); setShowPhone(false); }}>取消手机号修改</Button></>
          : <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border px-3"><span className="font-mono text-sm">{profile.phone || "未登记"}</span><Button type="button" variant="ghost" size="sm" onClick={() => { setValue("phone", profile.phone ?? ""); setShowPhone(true); }}>{profile.phone ? "修改" : "登记手机号"}</Button></div>}
        {errors.phone && <p role="alert" className="text-xs text-destructive">{errors.phone.message}</p>}
      </div>
      {emailChanged && <div className={layout === "stacked" ? "space-y-2" : "space-y-2 md:col-span-2"}>
        <p className="text-sm text-muted-foreground">保存后旧登录状态将失效，下次请使用新邮箱登录。</p>
        {(!adminTargetId || isSelf) && <><Label htmlFor={`${prefix}-password`}>当前密码</Label><Input id={`${prefix}-password`} className="max-w-sm" type="password" autoComplete="current-password" required {...register("currentPassword")} /></>}
      </div>}
      {extraFields}
    </fieldset>
    <div className="flex items-center gap-3"><Button type="submit" disabled={pending}>{pending ? "正在保存…" : "保存基本资料"}</Button><Button type="button" variant="ghost" disabled={pending} onClick={() => router.refresh()}>刷新资料</Button></div>
  </form>;
}
