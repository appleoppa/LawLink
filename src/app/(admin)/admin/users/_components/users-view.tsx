"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Plus,
  KeyRound,
  CircleOff,
  CircleDot,
  Loader2,
  LockOpen,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Users as UsersIcon
} from "lucide-react";
import type { SystemRole, UserRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import {
  createUser,
  updateUserRole,
  updateUserSystemRole,
  setUserActive,
  unlockUserLogin,
  resetUserPassword,
  forceEnforceTotp
} from "@/server/users/actions";
import { ProfileBasicsForm } from "@/components/users/profile-basics-form";
import { IdentityForm } from "@/components/users/identity-form";
import { IdentityDocumentFields, type IdentityDocumentDraft } from "@/components/users/identity-document-fields";
import { identityDocumentInputSchema } from "@/lib/identity-documents";
import { userRoleLabel } from "@/lib/enums";

type CustomRoleOption = { id: string; name: string; active: boolean };
const assignment = (value: string) => ROLES.includes(value as UserRole) ? { role: value as UserRole, roleDefinitionId: null } : { role: "CUSTOM" as const, roleDefinitionId: value };
const ROLES: UserRole[] = ["PRINCIPAL_LAWYER", "LAWYER", "ASSISTANT", "FINANCE"];

const createSchema = z.object({
  name: z.string().min(1).max(40),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.string().min(1, "请选择角色"),
  phone: z.string().max(30).optional()
});
type CreateValues = z.infer<typeof createSchema>;

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  systemRole: SystemRole;
  roleDefinitionId?: string | null;
  roleName?: string;
  roleActive?: boolean;
  phone: string | null;
  active: boolean;
  lastLoginAt: Date | null;
  lockedUntil?: Date | null;
  failedLoginAttempts?: number;
  totpEnabled?: boolean;
  totpEnforced?: boolean;
  createdAt: Date;
  updatedAt: Date;
  approvalMemberships: { group: { id: string; name: string } }[];
  _count: { ownedMatters: number; memberships: number };
};

export function UsersView({
  users,
  currentUserId,
  customRoles = [],
  builtinNames = {}
}: {
  users: UserRow[];
  currentUserId: string;
  customRoles?: CustomRoleOption[];
  builtinNames?: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = users.find(user => user.id === editingId) ?? null;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <UsersIcon className="h-4 w-4 text-primary" />
          用户管理 <span className="text-muted-foreground">({users.length})</span>
        </h2>
        <Button onClick={() => setSheetOpen(true)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          新增用户
        </Button>
      </header>

      <div className="flex gap-3"><Input aria-label="搜索账号" placeholder="按姓名、邮箱、角色或权限组搜索" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="账号状态" className="rounded-md border bg-background px-3 text-sm" value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部状态</option><option value="active">已启用</option><option value="inactive">已停用</option></select><a className="shrink-0 text-sm text-primary self-center" href="/admin/roles">管理角色</a><a className="shrink-0 text-sm text-primary self-center" href="/admin/approval-permissions">管理审批权限</a></div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-popover">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-5 py-3 font-medium">姓名 / 邮箱</th>
              <th className="px-5 py-3 font-medium">角色</th>
              <th className="px-5 py-3 font-medium">系统管理</th>
              <th className="px-5 py-3 font-medium">案件</th>
              <th className="px-5 py-3 font-medium">最近登录</th>
              <th className="px-5 py-3 font-medium">状态</th>
              <th className="px-5 py-3 font-medium">登录安全</th>
              <th className="px-5 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.filter(u => (status === "all" || u.active === (status === "active")) && `${u.name} ${u.email} ${u.roleName ?? userRoleLabel[u.role]} ${u.systemRole === "SUPER_ADMIN" ? "系统超级管理员" : "普通账号"} ${u.approvalMemberships.map(m => m.group.name).join(" ")}`.toLowerCase().includes(query.toLowerCase())).map((u) => (
              <UserRow
                key={u.id}
                user={u}
                customRoles={customRoles} builtinNames={builtinNames}
                isSelf={u.id === currentUserId}
                onResetPassword={() => setResetUser(u)}
                onEdit={() => setEditingId(u.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditingId(null); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>编辑账号资料</DialogTitle><DialogDescription>维护基本资料，或核对并更正身份证件及照片。</DialogDescription></DialogHeader>
          {editing && <div className="space-y-5">
            <ProfileBasicsForm key={`${editing.id}-${editing.updatedAt}`} adminTargetId={editing.id} isSelf={editing.id === currentUserId}
              profile={{ name: editing.name, email: editing.email, phone: editing.phone, updatedAt: new Date(editing.updatedAt).toISOString() }} onSaved={() => setEditingId(null)} />
            <IdentityForm key={`${editing.id}-${editing.updatedAt}`} adminTargetId={editing.id} />
          </div>}
        </DialogContent>
      </Dialog>
      <CreateUserSheet customRoles={customRoles} builtinNames={builtinNames} open={sheetOpen} onOpenChange={setSheetOpen} />
      <ResetPasswordDialog
        user={resetUser}
        onClose={() => setResetUser(null)}
      />
    </div>
  );
}

function UserRow({
  user,
  customRoles,
  builtinNames,
  isSelf,
  onResetPassword,
  onEdit
}: {
  user: UserRow;
  customRoles: CustomRoleOption[];
  builtinNames: Record<string, string>;
  isSelf: boolean;
  onResetPassword: () => void;
  onEdit: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function handleRoleChange(value: string) {
    if (value === (user.roleDefinitionId ?? user.role)) return;
    const target = customRoles.find(r => r.id === value)?.name ?? builtinNames[value] ?? userRoleLabel[value as UserRole];
    if (!confirm(`将角色从“${user.roleName ?? userRoleLabel[user.role]}”改为“${target}”？该账号需重新登录。`)) return;
    startTransition(async () => {
      try {
        await updateUserRole({ id: user.id, ...assignment(value), expectedRole: user.role, expectedRoleDefinitionId: user.roleDefinitionId ?? null });
        toast.success("角色已更新");
      } catch (err) {
        toast.error("更新失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  // v1.x P0-3: 解除登录锁定
  function handleUnlock() {
    if (!confirm(`解除 ${user.name} 的登录锁定？`)) return;
    startTransition(async () => {
      try {
        await unlockUserLogin({ id: user.id });
        toast.success("已解除锁定");
      } catch (err) {
        toast.error("操作失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  function handleToggleActive() {
    if (
      !confirm(user.active ? `禁用 ${user.name}？禁用后该用户无法登录。` : `重新激活 ${user.name}？`)
    )
      return;
    startTransition(async () => {
      try {
        const res = await setUserActive({ id: user.id, active: !user.active });
        toast.success(res.active ? "已激活" : "已禁用");
      } catch (err) {
        toast.error("操作失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  function handleSystemRoleChange() {
    const next: SystemRole = user.systemRole === "SUPER_ADMIN" ? "NONE" : "SUPER_ADMIN";
    const action = next === "SUPER_ADMIN" ? "授予系统超级管理员资格" : "撤销系统超级管理员资格";
    if (!confirm(`${action}：${user.name}？该账号的现有会话将失效。`)) return;
    startTransition(async () => {
      try {
        await updateUserSystemRole({ id: user.id, systemRole: next, expectedSystemRole: user.systemRole });
        toast.success(next === "SUPER_ADMIN" ? "已授予系统管理资格" : "已撤销系统管理资格");
      } catch (err) {
        toast.error("操作失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  // v1.x P1 收尾 c: 管理员强制账号开启双步验证（TOTP）
  function handleToggleTotpEnforce() {
    const next = !user.totpEnforced;
    if (isSelf && next && !user.totpEnabled) {
      toast.warning("你自己尚未绑定动态码：强制后将无法登录，请先在「个人设置 → 登录安全」完成绑定");
      return;
    }
    const warning = next
      ? user.totpEnabled
        ? `要求 ${user.name} 登录时使用双步验证？该账号已绑定动态码，每次登录都须验证。`
        : `要求 ${user.name} 开启双步验证？该账号尚未绑定动态码，完成绑定前将无法登录（需线下协助绑定）。`
      : `解除 ${user.name} 的双步验证强制要求？已绑定的动态码不受影响。`;
    if (!confirm(warning)) return;
    startTransition(async () => {
      try {
        const res = await forceEnforceTotp({ id: user.id, enabled: next });
        toast.success(res.enforced ? "已要求开启双步验证" : "已解除强制要求");
      } catch (err) {
        toast.error("操作失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <tr className={user.active ? "" : "opacity-60"}>
      <td className="px-5 py-3">
        <div className="font-medium">{user.name}</div>
        <div className="font-mono text-xs text-muted-foreground">{user.email}</div>
        {user.lockedUntil && new Date(user.lockedUntil) > new Date() && (
          <div className="mt-0.5 text-xs text-amber-600">登录锁定至 {new Date(user.lockedUntil).toLocaleString("zh-CN")}</div>
        )}
        <div className="mt-1 text-xs text-muted-foreground">审批权限组：{user.approvalMemberships.map(m => m.group.name).join("、") || "未分配"}</div>
      </td>
      <td className="px-5 py-3">
        {isSelf ? (
          <Badge variant="secondary" className="text-[10px]">
            {user.roleName ?? userRoleLabel[user.role]}（自己）
          </Badge>
        ) : (
          <Select
            value={user.roleDefinitionId ?? user.role}
            onValueChange={(v) => handleRoleChange(v)}
            disabled={isPending}
          >
            <SelectTrigger className="h-8 w-32 bg-background text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {builtinNames[r] ?? userRoleLabel[r]}
                </SelectItem>
              ))}
              {customRoles.filter(r => r.active || r.id === user.roleDefinitionId).map(r => <SelectItem key={r.id} value={r.id} disabled={!r.active}>{r.name}{!r.active ? "（已停用）" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </td>
      <td className="px-5 py-3">
        <Badge variant={user.systemRole === "SUPER_ADMIN" ? "secondary" : "outline"} className="text-[10px]">
          {user.systemRole === "SUPER_ADMIN" ? "系统超级管理员" : "无"}
        </Badge>
      </td>
      <td className="px-5 py-3 font-mono text-xs tabular text-muted-foreground">
        主办 {user._count.ownedMatters} · 参与 {user._count.memberships}
      </td>
      <td className="px-5 py-3 font-mono text-xs text-muted-foreground tabular">
        {user.lastLoginAt
          ? new Date(user.lastLoginAt).toLocaleDateString("zh-CN")
          : "从未登录"}
      </td>
      <td className="px-5 py-3">
        <Badge
          variant={user.active ? "secondary" : "outline"}
          className="text-[10px]"
        >
          {user.active ? "已激活" : "已禁用"}
        </Badge>
      </td>
      <td className="px-5 py-3">
        <div className="flex flex-col items-start gap-1">
          <Badge
            variant={user.totpEnabled ? "secondary" : "outline"}
            className={`text-[10px] ${user.totpEnabled ? "text-[#1A7F45]" : "text-muted-foreground"}`}
          >
            <Smartphone className="mr-1 h-3 w-3" />
            {user.totpEnabled ? "双步已绑定" : "双步未开启"}
          </Badge>
          {user.totpEnforced && (
            <span className="rounded-full border border-[#96650B]/35 bg-[#96650B]/10 px-1.5 py-px text-[10px] text-[#7A5209]">
              已强制要求
            </span>
          )}
        </div>
      </td>
      <td className="px-5 py-3">
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>资料</Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onResetPassword}
            disabled={isPending}
            className="h-7 gap-1 text-xs"
          >
            <KeyRound className="h-3.5 w-3.5" />
            改密码
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleTotpEnforce}
            disabled={isPending}
            className="h-7 gap-1 text-xs"
          >
            <Smartphone className="h-3.5 w-3.5" />
            {user.totpEnforced ? "解除强制" : "强制双步"}
          </Button>
          {!isSelf && (
            <>
              <Button variant="ghost" size="sm" onClick={handleSystemRoleChange} disabled={isPending} className="h-7 gap-1 text-xs">
                {user.systemRole === "SUPER_ADMIN" ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {user.systemRole === "SUPER_ADMIN" ? "撤销管理" : "授予管理"}
              </Button>
              {user.lockedUntil && new Date(user.lockedUntil) > new Date() && (
                <Button variant="ghost" size="sm" onClick={handleUnlock} disabled={isPending} className="h-7 gap-1 text-xs text-amber-600">
                  <LockOpen className="h-3.5 w-3.5" />解锁
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleActive}
                disabled={isPending}
                className={`h-7 gap-1 text-xs ${user.active ? "text-destructive" : "text-[#4ADE80]"}`}
              >
                {user.active ? <><CircleOff className="h-3.5 w-3.5" />禁用</> : <><CircleDot className="h-3.5 w-3.5" />激活</>}
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function CreateUserSheet({
  customRoles,
  builtinNames,
  open,
  onOpenChange
}: {
  customRoles: CustomRoleOption[];
  builtinNames: Record<string, string>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [identity, setIdentity] = useState<IdentityDocumentDraft>({
    documentType: "PRC_RESIDENT_ID",
    documentName: "",
    documentNumber: "",
    primaryFile: null,
    secondaryFile: null
  });
  const [identityErrors, setIdentityErrors] = useState<Partial<Record<"documentType" | "documentName" | "documentNumber" | "primaryFile", string>>>({});
  const {
    register,
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors }
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "LAWYER",
      phone: ""
    }
  });
  const role = useWatch({ control, name: "role" });

  function onSubmit(values: CreateValues) {
    const parsedIdentity = identityDocumentInputSchema.safeParse({
      identityDocumentType: identity.documentType,
      identityDocumentName: identity.documentName,
      identityDocumentNumber: identity.documentNumber
    });
    const nextErrors: typeof identityErrors = {};
    if (!parsedIdentity.success) {
      for (const issue of parsedIdentity.error.issues) {
        if (issue.path[0] === "identityDocumentName") nextErrors.documentName = issue.message;
        if (issue.path[0] === "identityDocumentNumber") nextErrors.documentNumber = issue.message;
        if (issue.path[0] === "identityDocumentType") nextErrors.documentType = issue.message;
      }
    }
    if (!identity.primaryFile) nextErrors.primaryFile = "请上传主要证件照片";
    setIdentityErrors(nextErrors);
    if (!parsedIdentity.success || !identity.primaryFile) return;
    startTransition(async () => {
      try {
        const roleAssignment = assignment(values.role);
        const formData = new FormData();
        formData.set("name", values.name);
        formData.set("email", values.email);
        formData.set("password", values.password);
        formData.set("phone", values.phone ?? "");
        formData.set("role", roleAssignment.role);
        if (roleAssignment.roleDefinitionId) formData.set("roleDefinitionId", roleAssignment.roleDefinitionId);
        formData.set("identityDocumentType", parsedIdentity.data.identityDocumentType);
        formData.set("identityDocumentName", parsedIdentity.data.identityDocumentName ?? "");
        formData.set("identityDocumentNumber", parsedIdentity.data.identityDocumentNumber);
        formData.set("identityImagePrimary", identity.primaryFile!);
        if (identity.secondaryFile) formData.set("identityImageSecondary", identity.secondaryFile);
        await createUser(formData);
        toast.success("用户已创建");
        reset();
        setIdentity({ documentType: "PRC_RESIDENT_ID", documentName: "", documentNumber: "", primaryFile: null, secondaryFile: null });
        setIdentityErrors({});
        onOpenChange(false);
      } catch (err) {
        toast.error("创建失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-2xl flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border bg-background px-6 py-4">
          <SheetTitle>新增用户</SheetTitle>
          <SheetDescription className="text-xs">
            登记基本资料和身份证件；初始密码可让用户登录后自行修改
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            <SheetField label="姓名" required error={errors.name?.message}>
              <Input {...register("name")} />
            </SheetField>
            <SheetField label="邮箱" required error={errors.email?.message}>
              <Input type="email" className="font-mono" {...register("email")} />
            </SheetField>
            <SheetField label="初始密码（至少 8 位）" required error={errors.password?.message}>
              <Input type="password" className="font-mono" {...register("password")} />
            </SheetField>
            <SheetField label="角色" required>
              <Select
                value={role}
                onValueChange={(v) =>
                  setValue("role", v as CreateValues["role"], { shouldDirty: true })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {builtinNames[r] ?? userRoleLabel[r]}
                    </SelectItem>
                  ))}
                  {customRoles.filter(r => r.active).map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </SheetField>
            <SheetField label="电话">
              <Input className="font-mono" {...register("phone")} />
            </SheetField>
            {Object.keys(identityErrors).length > 0 && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">请补全并核对身份证件信息。</div>}
            <IdentityDocumentFields
              value={identity}
              disabled={isPending}
              errors={identityErrors}
              onChange={next => { setIdentity(next); setIdentityErrors({}); }}
              onRecognizedName={name => setValue("name", name, { shouldDirty: true, shouldValidate: true })}
            />
          </div>

          <SheetFooter className="border-t border-border bg-background px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              取消
            </Button>
            <Button type="submit" disabled={isPending} className="gap-1.5">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              创建
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ResetPasswordDialog({
  user,
  onClose
}: {
  user: UserRow | null;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [pwd, setPwd] = useState("");

  function handleReset() {
    if (!user) return;
    if (pwd.length < 8) {
      toast.warning("密码至少 8 位");
      return;
    }
    startTransition(async () => {
      try {
        await resetUserPassword({ id: user.id, newPassword: pwd });
        toast.success(`已重置 ${user.name} 的密码`);
        setPwd("");
        onClose();
      } catch (err) {
        toast.error("失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重置 {user?.name} 的密码</DialogTitle>
          <DialogDescription>
            管理员重置后，用户使用新密码登录。建议线下告知用户。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">新密码（至少 8 位）</Label>
          <Input
            type="password"
            className="font-mono"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            取消
          </Button>
          <Button onClick={handleReset} disabled={isPending}>
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            重置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SheetField({
  label,
  required,
  error,
  children
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1 text-xs">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
