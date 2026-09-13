"use client";

/**
 * 法定期限规则管理卡片（P0-8 挂账项落地）。
 * 内置规则：编辑与启停；自定义规则：增删改。删除内置规则在服务端拒绝。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  createDeadlineRule, updateDeadlineRule, toggleDeadlineRule, deleteDeadlineRule
} from "@/server/deadline-rules/admin-actions";

export type AdminDeadlineRule = {
  id: string; code: string; name: string; description: string | null;
  triggerLabel: string; periodValue: number; periodUnit: "DAYS" | "MONTHS" | "YEARS";
  category: string; legalBasis: string; legalBasisUrl: string | null; verifiedAt: string | Date | null;
  remindDays: number; enabled: boolean; isBuiltIn: boolean;
};

const CATEGORY_CN: Record<string, string> = {
  LIMITATION: "诉讼时效", EVIDENCE: "举证", APPEAL: "上诉", PERFORMANCE: "履行",
  RESPONSE: "答辩", ENFORCEMENT: "执行", ARBITRATION_SET_ASIDE: "撤裁", PRESERVATION: "保全", CUSTOM: "其他"
};
const UNIT_CN: Record<string, string> = { DAYS: "天", MONTHS: "个月", YEARS: "年" };

type RuleCategory = "LIMITATION" | "EVIDENCE" | "APPEAL" | "PERFORMANCE" | "RESPONSE" | "ENFORCEMENT" | "ARBITRATION_SET_ASIDE" | "PRESERVATION" | "CUSTOM";

type FormState = {
  name: string; triggerLabel: string; periodValue: string; periodUnit: "DAYS" | "MONTHS" | "YEARS";
  category: RuleCategory; legalBasis: string; legalBasisUrl: string;
  description: string; remindDays: string; enabled: boolean;
};

const EMPTY_FORM: FormState = {
  name: "", triggerLabel: "", periodValue: "15", periodUnit: "DAYS", category: "CUSTOM",
  legalBasis: "", legalBasisUrl: "", description: "", remindDays: "7", enabled: true
};

export function DeadlineRulesCard({ rules }: { rules: AdminDeadlineRule[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setForm(EMPTY_FORM); setEditing({ id: null }); setError(null);
  }
  function openEdit(rule: AdminDeadlineRule) {
    setForm({
      name: rule.name, triggerLabel: rule.triggerLabel, periodValue: String(rule.periodValue),
      periodUnit: rule.periodUnit, category: rule.category as RuleCategory,
      legalBasis: rule.legalBasis, legalBasisUrl: rule.legalBasisUrl ?? "",
      description: rule.description ?? "", remindDays: String(rule.remindDays), enabled: rule.enabled
    });
    setEditing({ id: rule.id }); setError(null);
  }

  function submit() {
    setError(null);
    const payload = { ...form, periodValue: Number(form.periodValue), remindDays: Number(form.remindDays) };
    startTransition(async () => {
      try {
        if (editing?.id) await updateDeadlineRule({ id: editing.id, ...payload });
        else await createDeadlineRule(payload);
        setEditing(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存失败");
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">法定期限规则库</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            内置规则只能编辑与启停（法条依据为核心价值）；自定义规则可删除。规则调整后，已生成的期限不回溯，重算只生成待复核结果。
          </div>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[13px] hover:bg-accent">
          <Plus className="h-3.5 w-3.5" /> 新增规则
        </button>
      </div>

      <div className="mt-3 divide-y divide-border rounded-lg border border-border">
        {rules.length === 0 && <div className="p-3 text-[13px] text-muted-foreground">暂无规则</div>}
        {rules.map(rule => (
          <div key={rule.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium">{rule.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{CATEGORY_CN[rule.category] ?? rule.category}</span>
                {!rule.enabled && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">已停用</span>}
                {rule.isBuiltIn ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">内置</span> : null}
              </div>
              <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                {rule.triggerLabel}起 {rule.periodValue} {UNIT_CN[rule.periodUnit]} · {rule.legalBasis}
                {rule.verifiedAt ? " · 已核验" : ""}
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-1 text-[12px] text-muted-foreground">
              <input
                type="checkbox" checked={rule.enabled} disabled={pending}
                onChange={e => startTransition(async () => {
                  try { await toggleDeadlineRule({ id: rule.id, enabled: e.target.checked }); router.refresh(); }
                  catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
                })}
              />
              启用
            </label>
            <button onClick={() => openEdit(rule)} className="rounded p-1 hover:bg-accent" title="编辑">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {!rule.isBuiltIn && (
              <button
                onClick={() => {
                  if (!confirm(`确定删除规则「${rule.name}」？`)) return;
                  startTransition(async () => {
                    try { await deleteDeadlineRule({ id: rule.id }); router.refresh(); }
                    catch (err) { setError(err instanceof Error ? err.message : "删除失败"); }
                  });
                }}
                className="rounded p-1 text-destructive hover:bg-destructive/10" title="删除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-lg rounded-xl bg-card p-5 shadow-lg" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-semibold">{editing.id ? "编辑期限规则" : "新增期限规则"}</div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
              <label className="col-span-2 space-y-1">
                <span className="text-muted-foreground">规则名称 *</span>
                <input className="w-full rounded-md border px-2 py-1.5" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="如：民事上诉期" />
              </label>
              <label className="space-y-1">
                <span className="text-muted-foreground">触发事件 *</span>
                <input className="w-full rounded-md border px-2 py-1.5" value={form.triggerLabel}
                  onChange={e => setForm(f => ({ ...f, triggerLabel: e.target.value }))} placeholder="判决书送达之日" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-muted-foreground">期限值 *</span>
                  <input type="number" min={1} className="w-full rounded-md border px-2 py-1.5" value={form.periodValue}
                    onChange={e => setForm(f => ({ ...f, periodValue: e.target.value }))} />
                </label>
                <label className="space-y-1">
                  <span className="text-muted-foreground">单位</span>
                  <select className="w-full rounded-md border px-2 py-1.5" value={form.periodUnit}
                    onChange={e => setForm(f => ({ ...f, periodUnit: e.target.value as FormState["periodUnit"] }))}>
                    <option value="DAYS">天</option><option value="MONTHS">个月</option><option value="YEARS">年</option>
                  </select>
                </label>
              </div>
              <label className="space-y-1">
                <span className="text-muted-foreground">类别</span>
                <select className="w-full rounded-md border px-2 py-1.5" value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value as FormState["category"] }))}>
                  {Object.entries(CATEGORY_CN).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-muted-foreground">建议提前提醒（天）</span>
                <input type="number" min={0} max={60} className="w-full rounded-md border px-2 py-1.5" value={form.remindDays}
                  onChange={e => setForm(f => ({ ...f, remindDays: e.target.value }))} />
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-muted-foreground">法条依据 *</span>
                <input className="w-full rounded-md border px-2 py-1.5" value={form.legalBasis}
                  onChange={e => setForm(f => ({ ...f, legalBasis: e.target.value }))} placeholder="《中华人民共和国民事诉讼法(2023修正)》第一百七十一条" />
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-muted-foreground">法条链接</span>
                <input className="w-full rounded-md border px-2 py-1.5" value={form.legalBasisUrl}
                  onChange={e => setForm(f => ({ ...f, legalBasisUrl: e.target.value }))} placeholder="https://…" />
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-muted-foreground">说明</span>
                <input className="w-full rounded-md border px-2 py-1.5" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </label>
              <label className="col-span-2 flex items-center gap-2">
                <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
                启用该规则
              </label>
            </div>
            {error && <div className="mt-2 text-[12.5px] text-destructive">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-md border px-3 py-1.5 text-[13px] hover:bg-accent" onClick={() => setEditing(null)}>取消</button>
              <button className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground disabled:opacity-50"
                disabled={pending} onClick={submit}>{editing.id ? "保存" : "创建"}</button>
            </div>
          </div>
        </div>
      )}

      {!editing && error && <div className="mt-2 text-[12.5px] text-destructive">{error}</div>}
    </div>
  );
}
