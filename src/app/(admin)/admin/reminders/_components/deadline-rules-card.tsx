"use client";

/**
 * 期限规则库（墨案 12 效果图）：规则表 + 右栏推算示例。
 * 内置规则：编辑与启停；自定义规则：增删改。删除内置规则在服务端拒绝。
 * 推算示例用 lib/deadline-rules 的 computeDeadlineDate 与 lib/deadline-reminders 的
 * 真实提醒档位计算，不做节假日表（系统不内置，由人工核对顺延）。
 */
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Info, Pencil, Plus, Scale, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ProcedureType } from "@prisma/client";
import {
  createDeadlineRule, updateDeadlineRule, toggleDeadlineRule, deleteDeadlineRule
} from "@/server/deadline-rules/admin-actions";
import { computeDeadlineDate } from "@/lib/deadline-rules";
import { deadlineReminderOffsets } from "@/lib/deadline-reminders";
import { procedureTypeLabel } from "@/lib/enums";
import { FilterSelect } from "@/components/patterns/filter-select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type AdminDeadlineRule = {
  id: string; code: string; name: string; description: string | null;
  triggerLabel: string; periodValue: number; periodUnit: "DAYS" | "MONTHS" | "YEARS";
  category: string; legalBasis: string; legalBasisUrl: string | null; verifiedAt: string | Date | null;
  remindDays: number; enabled: boolean; isBuiltIn: boolean;
  applicableProcedures?: ProcedureType[];
};

const CATEGORY_CN: Record<string, string> = {
  LIMITATION: "诉讼时效", EVIDENCE: "举证", APPEAL: "上诉", PERFORMANCE: "履行",
  RESPONSE: "答辩", ENFORCEMENT: "执行", ARBITRATION_SET_ASIDE: "撤裁", PRESERVATION: "保全", CUSTOM: "其他"
};
const UNIT_CN: Record<string, string> = { DAYS: "日", MONTHS: "个月", YEARS: "年" };

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

const offsetLabel = (o: number) => (o === 0 ? "T-0" : o < 0 ? `T${o}` : `T+${o}`);
const mmdd = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function procedureScope(rule: AdminDeadlineRule) {
  const list = rule.applicableProcedures ?? [];
  if (list.length === 0) return "全部程序";
  if (list.length <= 2) return list.map((p) => procedureTypeLabel[p]).join(" / ");
  return `${procedureTypeLabel[list[0]]} 等 ${list.length} 项`;
}

function OffsetChips({ remindDays }: { remindDays: number }) {
  return (
    <span className="inline-flex flex-wrap gap-1" style={{ maxWidth: 170 }}>
      {deadlineReminderOffsets(remindDays).map((o) => (
        <span key={o} className="offset-chip" style={o > 0 ? { background: "var(--red-bg)", color: "var(--red)" } : undefined}>
          {offsetLabel(o)}
        </span>
      ))}
    </span>
  );
}

export function DeadlineRulesCard({ rules, rail, headerActions }: { rules: AdminDeadlineRule[]; rail?: ReactNode; headerActions?: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(rules.find((r) => r.enabled)?.id ?? rules[0]?.id ?? null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) =>
      (!category || r.category === category) &&
      (!q || [r.name, r.code, r.triggerLabel, r.legalBasis, procedureScope(r)].some((v) => v.toLowerCase().includes(q)))
    );
  }, [rules, search, category]);
  const selected = rules.find((r) => r.id === selectedId) ?? null;

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
        toast.success("规则已保存");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存失败");
      }
    });
  }

  function toggle(rule: AdminDeadlineRule, enabled: boolean) {
    startTransition(async () => {
      try {
        await toggleDeadlineRule({ id: rule.id, enabled });
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "操作失败");
      }
    });
  }

  function remove(rule: AdminDeadlineRule) {
    if (!confirm(`确定删除规则「${rule.name}」？已生成的期限不受影响。`)) return;
    startTransition(async () => {
      try {
        await deleteDeadlineRule({ id: rule.id });
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "删除失败");
      }
    });
  }

  // 推算示例：以今天作为起算事件发生日
  const example = useMemo(() => {
    if (!selected) return null;
    const trigger = new Date();
    const due = computeDeadlineDate(trigger, selected.periodValue, selected.periodUnit);
    const offsets = deadlineReminderOffsets(selected.remindDays);
    return {
      trigger,
      due,
      tiers: offsets.map((o) => {
        const d = new Date(due);
        d.setDate(d.getDate() + o);
        return { offset: o, date: d };
      })
    };
  }, [selected]);

  return (
    <>
      <div className="page-head flex-wrap gap-3">
        <div>
          <div className="crumbs">设置 › 业务规则 › <b>期限规则库</b></div>
          <h1 className="ph-title">期限规则库</h1>
          <p className="ph-sub">法定期限由规则推算生成：起算事件 + 期限，并按统一档位阶梯预警。案件内人工修正过的期限保留修改人与来源，规则调整不回溯已生成的期限。</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {headerActions}
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus /> 新建规则
          </button>
        </div>
      </div>

      <div className="flow-strip">
        <div className="card flow-card">
          <div className="flow-ic" style={{ background: "var(--teal-soft)", color: "var(--teal-deep)" }}><Scale /></div>
          <div><div className="flow-t">① 起算事件发生</div><div className="flow-d">如：判决书送达之日、立案受理之日，由程序环节与材料识别记录</div></div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="card flow-card">
          <div className="flow-ic" style={{ background: "var(--blue-bg)", color: "var(--blue)" }}><Info /></div>
          <div><div className="flow-t">② 规则推算期限</div><div className="flow-d">按日 / 月 / 年计算（期间开始日不计入），届满日遇法定休假日由人工核对顺延</div></div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="card flow-card">
          <div className="flow-ic" style={{ background: "var(--amber-bg)", color: "var(--amber)" }}><Search /></div>
          <div><div className="flow-t">③ 阶梯预警推送</div><div className="flow-d">T-3 / T-1 / T-0 / T+1 固定四档，另加规则建议提前档；逾期升级团队负责人</div></div>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="card" style={{ overflow: "hidden", minWidth: 0 }}>
          <div className="panel-head flex-wrap gap-2">
            <div className="panel-title">
              <Scale className="ic" strokeWidth={1.8} />
              规则列表 <span className="badge b-white" style={{ marginLeft: 2 }}>{rules.length}</span>
              <span className="t-xs t-mute" style={{ fontWeight: 400 }}>启用 {rules.filter((r) => r.enabled).length}</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label className="mo-toolbar-input" style={{ width: 220, height: 30 }}>
                <Search aria-hidden />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="按规则名称、起算事件搜索" aria-label="搜索规则" />
              </label>
              <FilterSelect label="类别" value={category} options={Object.entries(CATEGORY_CN).map(([value, label]) => ({ value, label }))} onChange={setCategory} />
            </div>
          </div>
          <div className="mo-scroll-x">
            <table className="table rtable" style={{ minWidth: 760, tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ width: "27%" }}>规则名称</th>
                  <th style={{ width: "14%" }}>适用程序</th>
                  <th style={{ width: "17%" }}>起算事件</th>
                  <th style={{ width: "10%" }}>期限</th>
                  <th style={{ width: "20%" }}>预警阶梯</th>
                  <th style={{ width: 96 }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6}><div className="empty mo-empty-compact"><div className="mo-empty-title">{rules.length ? "没有匹配的规则" : "暂无规则"}</div></div></td></tr>
                ) : filtered.map((rule) => (
                  <tr
                    key={rule.id}
                    className={cn("group cursor-pointer", !rule.enabled && "opacity-60")}
                    style={rule.id === selectedId ? { background: "var(--teal-soft)" } : undefined}
                    onClick={() => setSelectedId(rule.id)}
                    aria-selected={rule.id === selectedId}
                  >
                    <td>
                      <div className="rule-name">{rule.name}</div>
                      <div className="rule-meta truncate" title={`${rule.code} · ${rule.legalBasis}`}>
                        {rule.isBuiltIn ? "内置" : "自定义"} · {CATEGORY_CN[rule.category] ?? rule.category}
                        {rule.verifiedAt ? <span style={{ color: "var(--green)", fontWeight: 600 }}> · 法条已核验</span> : <span> · 法条未核验</span>}
                      </div>
                    </td>
                    <td><span className="badge b-white max-w-full truncate" title={procedureScope(rule)}>{procedureScope(rule)}</span></td>
                    <td className="t-sm">{rule.triggerLabel}</td>
                    <td>
                      <div className="num-md whitespace-nowrap">{rule.periodValue} {UNIT_CN[rule.periodUnit]}</div>
                      <span className="offset-chip" style={{ marginTop: 3, display: "inline-block" }}>{rule.periodUnit === "DAYS" ? "自然日" : "对应日"}</span>
                    </td>
                    <td><OffsetChips remindDays={rule.remindDays} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5">
                        <Switch checked={rule.enabled} disabled={pending} onCheckedChange={(v) => toggle(rule, v)} aria-label={rule.enabled ? `停用 ${rule.name}` : `启用 ${rule.name}`} />
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(rule)} aria-label={`编辑 ${rule.name}`}><Pencil /></button>
                        {!rule.isBuiltIn ? (
                          <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ color: "var(--red)" }} onClick={() => remove(rule)} aria-label={`删除 ${rule.name}`}><Trash2 /></button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-foot">
            <span className="t-xs t-mute">规则变更记录审计；停用规则不影响已生成期限。内置规则只能编辑与启停（法条依据为核心价值），自定义规则可删除。</span>
          </div>
        </div>

        <div className="example" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <div className="panel-head">
              <div className="panel-title truncate" style={{ fontSize: 13 }}>推算示例{selected ? ` · ${selected.name}` : ""}</div>
            </div>
            {selected && example ? (
              <>
                <div className="panel-body" style={{ padding: "6px 0 10px" }}>
                  <div className="ex-day">
                    <span className="ex-date">{mmdd(example.trigger)}</span><span className="ex-role">{selected.triggerLabel}（假设今天发生）</span>
                    <span className="badge b-white ex-tag">起算</span>
                  </div>
                  <div className="ex-day">
                    <span className="ex-date">+{selected.periodValue}{selected.periodUnit === "DAYS" ? "" : UNIT_CN[selected.periodUnit]}</span>
                    <span className="ex-role">{selected.periodUnit === "DAYS" ? "自然日计算 · 期间不含起算当日" : "取届满月对应日，无对应日取月末"}</span>
                    <span className="badge b-white ex-tag">计算</span>
                  </div>
                  <div className="ex-day">
                    <span className="ex-date">{mmdd(example.due)}</span><span className="ex-role">届满日（遇法定休假日需人工核对顺延）</span>
                    <span className="badge b-blue ex-tag">届满</span>
                  </div>
                  {example.tiers.map((t) => (
                    <div key={t.offset} className="ex-day" style={{ background: "#FBFDFC" }}>
                      <span className="ex-date" style={{ color: t.offset > 0 ? "var(--red)" : t.offset === 0 ? "var(--teal-deep)" : "var(--amber)" }}>{mmdd(t.date)}</span>
                      <span className="ex-role">{t.offset > 0 ? `${offsetLabel(t.offset)} 逾期升级（通知主办 + 团队负责人）` : t.offset === 0 ? "T-0 到期当日提醒" : `${offsetLabel(t.offset)} 预警`}</span>
                      {t.offset > 0 ? <span className="badge b-outline-red ex-tag">升级</span> : <span className="offset-chip ex-tag">通知</span>}
                    </div>
                  ))}
                </div>
                <div className="panel-foot" style={{ padding: "10px 14px" }}>
                  <div className="ex-note">
                    <Info />
                    <span>系统不内置节假日表（每年由国务院调整），届满日遇法定休假日请人工核对顺延。案件内人工修改过的期限会记录<b>修改人与时间</b>，规则调整不回溯。</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="panel-body t-xs t-mute">点击左侧规则查看推算示例</div>
            )}
          </div>
          {rail}
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="mo-rules max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "编辑期限规则" : "新建期限规则"}</DialogTitle>
            <DialogDescription>保存后仅影响此后按规则生成的期限，已生成的期限不回溯。</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>规则名称 *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="如：民事上诉期" />
            </div>
            <div className="space-y-1.5">
              <Label>起算事件 *</Label>
              <Input value={form.triggerLabel} onChange={(e) => setForm((f) => ({ ...f, triggerLabel: e.target.value }))} placeholder="判决书送达之日" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>期限值 *</Label>
                <Input type="number" min={1} value={form.periodValue} onChange={(e) => setForm((f) => ({ ...f, periodValue: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>单位</Label>
                <Select value={form.periodUnit} onValueChange={(v) => setForm((f) => ({ ...f, periodUnit: v as FormState["periodUnit"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAYS">日</SelectItem>
                    <SelectItem value="MONTHS">个月</SelectItem>
                    <SelectItem value="YEARS">年</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>类别</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v as RuleCategory }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_CN).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>建议提前提醒（天）</Label>
              <Input type="number" min={0} max={60} value={form.remindDays} onChange={(e) => setForm((f) => ({ ...f, remindDays: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>法条依据 *</Label>
              <Input value={form.legalBasis} onChange={(e) => setForm((f) => ({ ...f, legalBasis: e.target.value }))} placeholder="《中华人民共和国民事诉讼法(2023修正)》第一百七十一条" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>法条链接</Label>
              <Input value={form.legalBasisUrl} onChange={(e) => setForm((f) => ({ ...f, legalBasisUrl: e.target.value }))} placeholder="https://…" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>说明</Label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <label className="col-span-2 flex items-center gap-2 text-[13px]">
              <Checkbox checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v === true }))} />
              启用该规则
            </label>
            <div className="col-span-2 flex items-center gap-2 t-xs t-mute">预警档位<OffsetChips remindDays={Number(form.remindDays) || 0} /></div>
          </div>
          {error ? <div className="text-[12.5px] text-[var(--red)]">{error}</div> : null}
          <DialogFooter>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>取消</button>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>{editing?.id ? "保存" : "创建"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
