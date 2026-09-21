"use client";

/** 墨案 10 客户详情的交互零件：疑似重复横幅 + 合并向导、添加联系人 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GitMerge, Loader2, Plus, ScanSearch } from "lucide-react";
import { mergeClientsByCode } from "@/server/clients/dedup";
import { addContact } from "@/server/clients/actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { actionErrorMessage } from "@/lib/action-error";

export function MergeBanner({
  keepId,
  keepName,
  suspects,
  canMerge
}: {
  keepId: string;
  keepName: string;
  suspects: { id: string; name: string; internalCode: string | null; reason: string }[];
  canMerge: boolean;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(suspects[0]?.internalCode ?? "");
  const [basis, setBasis] = useState("");
  const [pending, start] = useTransition();
  if (!canMerge || dismissed) {
    return canMerge ? null : null;
  }
  const s = suspects[0];

  function submit() {
    if (!code.trim() || !basis.trim()) {
      toast.warning("请填写被合并客户编号与合并依据");
      return;
    }
    start(async () => {
      try {
        await mergeClientsByCode({ keepId, mergeCode: code.trim(), basis: basis.trim() });
        toast.success("合并完成：被合并档案已停用并保留映射");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? actionErrorMessage(e) : "合并失败");
      }
    });
  }

  return (
    <>
      {s ? (
        <div className="merge-banner">
          <div className="ic-wrap"><ScanSearch /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="merge-t">发现疑似同一主体的客户档案</div>
            <div className="merge-d">
              「{keepName}」与「{s.name}」{s.reason}{s.internalCode ? `（${s.internalCode}）` : ""}。本所采用身份持续唯一策略：合并只调整当前关联，<b>不改写历史身份快照</b>，保留原记录映射与合并依据；被合并档案转为已合并状态。
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)}>忽略本次</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>查看合并建议</button>
          </div>
        </div>
      ) : null}
      {!s ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} data-merge-trigger>
          <GitMerge />
          合并重复档案
        </button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>合并客户档案</DialogTitle>
            <DialogDescription>将另一档案并入「{keepName}」。联系人、收案与案件关联转移至本档案；历史冲突核查、审批与正式成果中的身份快照保持原貌。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {suspects.length > 0 ? (
              <div className="space-y-1.5">
                <Label>疑似重复档案</Label>
                {suspects.map((x) => (
                  <label key={x.id} className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-[var(--bd-hair)] px-3 py-2 text-[12.5px] hover:bg-[var(--bg-hover)]">
                    <input type="radio" name="merge-suspect" checked={code === (x.internalCode ?? "")} onChange={() => setCode(x.internalCode ?? "")} disabled={!x.internalCode} />
                    <span className="min-w-0 flex-1 truncate font-[550]">{x.name}</span>
                    <span className="badge b-amber">{x.reason}</span>
                    <span className="font-mono text-[11px] text-[var(--t-muted)]">{x.internalCode ?? "无编号"}</span>
                  </label>
                ))}
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="merge-code">被合并客户编号</Label>
              <Input id="merge-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="KH-2026-0001" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="merge-basis">合并依据（记入审计）</Label>
              <Input id="merge-basis" value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="如：统一社会信用代码一致，同一主体重复建档" />
            </div>
          </div>
          <DialogFooter>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={pending}>取消</button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <GitMerge />}
              确认合并
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AddContactButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ name: "", title: "", phone: "", email: "", isPrimary: false });
  function submit() {
    if (!form.name.trim()) {
      toast.warning("请填写联系人姓名");
      return;
    }
    start(async () => {
      try {
        await addContact(clientId, { ...form, wechat: "", notes: "" });
        toast.success("联系人已添加");
        setOpen(false);
        setForm({ name: "", title: "", phone: "", email: "", isPrimary: false });
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? actionErrorMessage(e) : "添加失败");
      }
    });
  }
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <Plus />
        添加联系人
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>添加联系人</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>姓名 *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>职务 / 对接事项</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：财务对接" /></div>
            <div className="space-y-1.5"><Label>电话</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="font-mono" /></div>
            <div className="space-y-1.5"><Label>邮箱</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <label className="col-span-2 flex items-center gap-2 text-[12.5px]"><Checkbox checked={form.isPrimary} onCheckedChange={(v) => setForm({ ...form, isPrimary: v === true })} />设为主要联系人</label>
          </div>
          <DialogFooter>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={pending}>取消</button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : null}添加</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
