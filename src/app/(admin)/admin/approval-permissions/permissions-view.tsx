"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApprovalAction, MatterCategory, SealType } from "@prisma/client";
import { ACTION_LABELS } from "@/lib/approvals/rules";
import { matterCategoryLabel } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPermissionAdministration, savePermissionGroup, saveSealPurpose, saveApprovalSettings, type PermissionGroupInput } from "@/server/approval-permissions/actions";
import { AdminPageHeader } from "@/components/layout/admin-page-header";
import { actionErrorMessage } from "@/lib/action-error";

type Data = Awaited<ReturnType<typeof getPermissionAdministration>>;
const sealLabels: Record<SealType, string> = { OFFICIAL_SEAL: "律所公章", CONTRACT_SEAL: "合同专用章", FINANCE_SEAL: "财务专用章", LEGAL_REP_SEAL: "法定代表人章", CONTRACT_REVIEW_SEAL: "合同审核章" };
const blankRule = (): PermissionGroupInput["rules"][number] => ({ action: "INTAKE_APPROVE", caseScope: "CATEGORIES", categories: [], allSealPurposes: false, purposeId: null, sealTypes: [] });
const blankGroup = (): PermissionGroupInput => ({ name: "", description: "", active: true, userIds: [], rules: [blankRule()] });
const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";
function Checks<T extends string>({ label, options, values, onChange }: { label: string; options: [T, string][]; values: T[]; onChange: (values: T[]) => void }) {
  return <fieldset className="space-y-2"><legend className="text-sm font-medium">{label}</legend><div className="flex flex-wrap gap-x-5 gap-y-2">{options.map(([id, text]) => <label key={id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.includes(id)} onChange={e => onChange(e.target.checked ? [...values, id] : values.filter(v => v !== id))} />{text}</label>)}</div></fieldset>;
}
export function PermissionAdministration({ data }: { data: Data }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [group, setGroup] = useState<PermissionGroupInput | null>(null);
  const [purpose, setPurpose] = useState<{ id?: string; name: string; description: string; active: boolean; allowedSealTypes: SealType[] } | null>(null);
  const [query, setQuery] = useState("");
  const [allowSelf, setAllowSelf] = useState(data.settings.allowSelfApproval);
  function run(fn: () => Promise<unknown>, close?: () => void) { start(async () => { try { await fn(); close?.(); router.refresh(); toast.success("已保存"); } catch (e) { toast.error(e instanceof Error ? actionErrorMessage(e) : "保存失败"); } }); }
  function patchRule(index: number, patch: Partial<PermissionGroupInput["rules"][number]>) { if (group) setGroup({ ...group, rules: group.rules.map((r, i) => i === index ? { ...r, ...patch } : r) }); }
  return <div className="space-y-6">
    <AdminPageHeader title="审批权限" sub="审批资格与系统管理身份分开，所有人员均按案件类别和具体事项分配审批权限。" />
    <section className="rounded-xl border bg-card p-5 space-y-3"><h3 className="font-medium">按事项授权</h3>
      <p className="text-sm text-muted-foreground">系统超级管理员也必须加入相应权限组才可处理收案、文书、归档、开票、用章审批及盖章回填；仍须遵守本人审批限制，审批法定代表人章时须核对当前法定代表人。停用权限组或移除账号立即生效；无可审批人员时无法提交。</p>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={allowSelf} onChange={e => setAllowSelf(e.target.checked)} />允许审批本人申请（仅适用于单人执业，仍须具备对应授权）</label>
      <Button disabled={pending} onClick={() => run(() => saveApprovalSettings({ allowSelfApproval: allowSelf }))}>保存本人审批设置</Button>
    </section>
    <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold">权限组</h3><Button size="sm" onClick={() => setGroup(blankGroup())}>新增权限组</Button></div>
      {!data.groups.length && <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">先建立“民事收案审批”等权限组，再勾选负责人员。一个人可以加入多个权限组。</p>}
      {data.groups.map(g => <div key={g.id} className="rounded-xl border bg-card p-4"><div className="flex items-center justify-between"><div><h4 className="font-medium">{g.name} {!g.active && <span className="text-muted-foreground">· 已停用</span>}</h4><p className="text-sm text-muted-foreground">{g.description}</p></div><Button variant="outline" size="sm" onClick={() => setGroup({ id: g.id, name: g.name, description: g.description ?? "", active: g.active, userIds: g.members.map(m => m.userId), rules: g.rules.map(r => ({ action: r.action, caseScope: r.caseScope, categories: r.categories, allSealPurposes: r.allSealPurposes, purposeId: r.purposeId, sealTypes: r.sealTypes })) })}>编辑</Button></div>
        <ul className="my-3 space-y-1 text-sm">{g.rules.map(r => <li key={r.id}>{ACTION_LABELS[r.action]} · {r.caseScope === "ALL_CASES" ? "全部案件" : r.caseScope === "NON_CASE" ? "非案件事项" : r.categories.map(c => matterCategoryLabel[c]).join("、")}{r.action.startsWith("SEAL_") && <> · {r.allSealPurposes ? "全部用章事项" : data.purposes.find(p => p.id === r.purposeId)?.name ?? "事项已失效"} · {r.sealTypes.map(t => sealLabels[t]).join("、")}</>}</li>)}</ul>
        <p className="text-xs text-muted-foreground">负责人员：{g.members.map(m => data.users.find(u => u.id === m.userId)?.name).join("、") || "尚未分配"}</p></div>)}
    </section>
    <section className="space-y-3"><div className="flex justify-between"><h3 className="font-semibold">用章事项</h3><Button size="sm" variant="outline" onClick={() => setPurpose({ name: "", description: "", active: true, allowedSealTypes: [] })}>新增事项</Button></div><p className="text-sm text-muted-foreground">例如委托合同、所函介绍信、顾问合同审核、财务文件、行政文件。</p>
      {data.purposes.map(p => <div key={p.id} className="flex items-center justify-between rounded-lg border bg-card p-3"><div className="text-sm">{p.name}{!p.active && " · 已停用"}<p className="text-xs text-muted-foreground">{p.allowedSealTypes.map(t => sealLabels[t]).join("、")}</p></div><Button size="sm" variant="ghost" onClick={() => setPurpose({ id: p.id, name: p.name, description: p.description ?? "", active: p.active, allowedSealTypes: p.allowedSealTypes })}>编辑</Button></div>)}
    </section>

    <Dialog open={!!group} onOpenChange={open => { if (!open && !pending) setGroup(null); }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{group?.id ? "编辑权限组" : "新增权限组"}</DialogTitle></DialogHeader>{group && <form className="space-y-5" onSubmit={e => { e.preventDefault(); run(() => savePermissionGroup(group), () => setGroup(null)); }}>
      <Label className="block space-y-2"><span>权限组名称</span><Input required maxLength={60} value={group.name} onChange={e => setGroup({ ...group, name: e.target.value })} placeholder="例如：民事案件审批" /></Label>
      <Label className="block space-y-2"><span>职责说明</span><Textarea value={group.description} onChange={e => setGroup({ ...group, description: e.target.value })} maxLength={300} /></Label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={group.active} onChange={e => setGroup({ ...group, active: e.target.checked })} />启用此权限组</label>
      {group.rules.map((r, i) => <fieldset key={i} className="space-y-3 rounded-xl border p-4"><legend className="px-1 text-sm">授权规则 {i + 1}</legend><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">审批事项<select aria-label={`规则 ${i + 1} 审批事项`} className={selectClass} value={r.action} onChange={e => patchRule(i, { action: e.target.value as ApprovalAction })}>{Object.entries(ACTION_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="text-sm">案件范围<select aria-label={`规则 ${i + 1} 案件范围`} className={selectClass} value={r.caseScope} onChange={e => patchRule(i, { caseScope: e.target.value as typeof r.caseScope })}><option value="CATEGORIES">指定案件类别</option><option value="ALL_CASES">全部案件类别</option><option value="NON_CASE">非案件事项</option></select></label></div>
        {r.caseScope === "CATEGORIES" && <Checks label="案件类别（至少一项）" options={Object.values(MatterCategory).map(c => [c, matterCategoryLabel[c]])} values={r.categories} onChange={categories => patchRule(i, { categories })} />}
        {r.action.startsWith("SEAL_") && <><label className="block text-sm">用章事项<select className={selectClass} value={r.allSealPurposes ? "ALL" : r.purposeId ?? ""} onChange={e => patchRule(i, { allSealPurposes: e.target.value === "ALL", purposeId: e.target.value && e.target.value !== "ALL" ? e.target.value : null })}><option value="">请选择事项</option><option value="ALL">全部用章事项（含以后新增）</option>{data.purposes.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><Checks label="印章类型（至少一项）" options={Object.entries(sealLabels) as [SealType, string][]} values={r.sealTypes} onChange={sealTypes => patchRule(i, { sealTypes })} /></>}
        {group.rules.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => setGroup({ ...group, rules: group.rules.filter((_, n) => n !== i) })}>移除此规则</Button>}
      </fieldset>)}<Button type="button" variant="outline" onClick={() => setGroup({ ...group, rules: [...group.rules, blankRule()] })}>增加授权规则</Button>
      <div className="space-y-3"><Input aria-label="搜索负责人员" placeholder="搜索负责人员" value={query} onChange={e => setQuery(e.target.value)} /><Checks label="分配给账号（支持多选）" options={data.users.filter(u => u.name.includes(query)).map(u => [u.id, `${u.name}${u.active ? "" : "（停用）"}`])} values={group.userIds} onChange={userIds => setGroup({ ...group, userIds })} /></div><Button type="submit" disabled={pending}>保存权限组</Button>
    </form>}</DialogContent></Dialog>
    <Dialog open={!!purpose} onOpenChange={open => { if (!open && !pending) setPurpose(null); }}><DialogContent><DialogHeader><DialogTitle>用章事项</DialogTitle></DialogHeader>{purpose && <form className="space-y-4" onSubmit={e => { e.preventDefault(); run(() => saveSealPurpose(purpose), () => setPurpose(null)); }}><Label className="block space-y-2"><span>事项名称</span><Input required value={purpose.name} onChange={e => setPurpose({ ...purpose, name: e.target.value })} /></Label><Label className="block space-y-2"><span>说明</span><Textarea value={purpose.description} onChange={e => setPurpose({ ...purpose, description: e.target.value })} /></Label><Checks label="允许使用的印章" options={Object.entries(sealLabels) as [SealType, string][]} values={purpose.allowedSealTypes} onChange={allowedSealTypes => setPurpose({ ...purpose, allowedSealTypes })} /><label className="flex gap-2 text-sm"><input type="checkbox" checked={purpose.active} onChange={e => setPurpose({ ...purpose, active: e.target.checked })} />启用事项</label><Button disabled={pending}>保存事项</Button></form>}</DialogContent></Dialog>
  </div>;
}
