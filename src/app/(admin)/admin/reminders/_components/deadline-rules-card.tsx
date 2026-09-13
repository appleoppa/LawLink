"use client";

/**
 * 法定期限规则管理卡片（P0-8 挂账项落地）。
 * 内置规则：编辑与启停；自定义规则：增删改。删除内置规则在服务端拒绝。
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Scale } from "lucide-react";
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
    <section className="ll-surface">
      <header className="ll-panel-head flex-wrap">
        <h2 className="ll-panel-title">
          <Scale className="h-4 w-4 text-primary" />
          法定期限规则库
          <span className="font-mono text-xs text-muted-foreground tabular">
            {rules.filter(r => r.enabled).length}/{rules.length}
          </span>
        </h2>
        <button onClick={openCreate} className="btn btn-primary btn-sm">
          <Plus className="h-3.5 w-3.5" /> 新增规则
        </button>
      </header>

      <div className="hidden grid-cols-[minmax(220px,1.4fr)_92px_minmax(160px,1fr)_84px_128px_128px_64px] gap-3 border-b border-border/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 lg:grid">
        <div>规则</div>
        <div>类别</div>
        <div>起算事件</div>
        <div>期限</div>
        <div>提醒档</div>
        <div>法条核验</div>
        <div className="text-right">操作</div>
      </div>

      {rules.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">暂无规则</div>}
      <div className="divide-y divide-border/60">
        {rules.map(rule => (
          <div
            key={rule.id}
            className={`grid grid-cols-1 items-center gap-2 px-4 py-2.5 lg:grid-cols-[minmax(220px,1.4fr)_92px_minmax(160px,1fr)_84px_128px_128px_64px] lg:gap-3 ${rule.enabled ? "" : "opacity-55"}`}
          >
            <div className="min-w-0">
              <div className="truncate text-[12.75px] font-semibold">{rule.name}</div>
              <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground/80">
                {rule.code}
                {rule.isBuiltIn ? " · 内置" : " · 自定义"}
              </div>
            </div>
            <div>
              <span className="badge b-white">{CATEGORY_CN[rule.category] ?? rule.category}</span>
            </div>
            <div className="truncate text-xs text-muted-foreground" title={rule.triggerLabel}>
              {rule.triggerLabel}
            </div>
            <div className="num-md">
              {rule.periodValue}
              <span className="ml-0.5 font-sans text-[11px] text-muted-foreground">{UNIT_CN[rule.periodUnit]}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {rule.remindDays > 0 && (
                <span className="rounded-full border border-[#B7D8D6] bg-[#E4F1F0] px-1.5 py-px font-mono text-[10px] text-[#005054]">
                  T-{rule.remindDays}
                </span>
              )}
              <span className="rounded-full px-1.5 py-px font-mono text-[10px]" style={{ background: "rgba(180,35,24,0.08)", color: "#B42318" }}>
                T+1
              </span>
            </div>
            <div className="min-w-0 text-[11px]" title={rule.legalBasis + (rule.legalBasisUrl ? ` · ${rule.legalBasisUrl}` : "")}>
              {rule.verifiedAt ? (
                <span className="badge b-green">
                  <span className="bdot" aria-hidden />
                  已核验
                </span>
              ) : (
                <span className="text-muted-foreground/70">未核验</span>
              )}
              <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground/75">{rule.legalBasis}</div>
            </div>
            <div className="flex items-center justify-end gap-1">
              <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground" title={rule.enabled ? "点击停用" : "点击启用"}>
                <input
                  type="checkbox" checked={rule.enabled} disabled={pending}
                  onChange={e => startTransition(async () => {
                    try { await toggleDeadlineRule({ id: rule.id, enabled: e.target.checked }); router.refresh(); }
                    catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
                  })}
                />
                {rule.enabled ? "启用" : "停用"}
              </label>
              <button onClick={() => openEdit(rule)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="编辑">
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
          </div>
        ))}
      </div>

      <footer className="ll-panel-foot text-[11px] leading-relaxed text-muted-foreground">
        内置规则只能编辑与启停（法条依据为核心价值）；自定义规则可删除。规则调整后已生成的期限不回溯，重算只生成待复核结果。提醒扫描另含固定四档：T-3 / T-1 / T-0 / T+1（逾期首日，红档）。
      </footer>

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

      {!editing && error && <div className="mt-2 px-4 pb-2 text-[12.5px] text-destructive">{error}</div>}
    </section>
  );
}
