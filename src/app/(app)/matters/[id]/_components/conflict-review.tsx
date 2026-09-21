'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ShieldAlert } from 'lucide-react';
import { runMatterReview, decideMatterReview } from '@/server/conflicts/matter-actions';
import type { readMatterReview } from '@/server/conflicts/matter-review';
import { conflictConclusionLabel } from '@/lib/enums';
import { formatDateTime } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';

/** 侧栏常驻的动态冲突复核卡（2026-09-20 用户确认：仅在待复核时渲染，放侧栏不占主视觉）。
 *  是新增程序、委托合同、补充协议生效三处写路径门禁（assertMatterReviewCurrent）的操作出口。 */
export function MatterConflictReview({ matterId, data, canWrite }: { matterId: string; data: Awaited<ReturnType<typeof readMatterReview>>; canWrite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  if (!data || !data.needsReview) return null;

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      router.refresh();
      toast.success('冲突核查已保存');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '核查失败');
    } finally {
      setBusy(false);
    }
  }

  const latest = data.checks[0];
  return (
    <div className="card" aria-label="利益冲突复核">
      <div className="rail-sec-head">
        <ShieldAlert className="h-[15px] w-[15px] text-[var(--amber)]" strokeWidth={1.8} />
        利益冲突复核
        <span className="badge b-amber" style={{ fontSize: 10 }}>待复核</span>
      </div>
      <div className="panel-body space-y-2">
        <p className="t-xs t-mute">主体或代理范围已变化；复核通过前，新增程序、委托合同与补充协议无法办理。</p>
        {canWrite ? (
          <button disabled={busy} className="btn btn-secondary btn-sm w-full" onClick={() => void run(() => runMatterReview(matterId))}>
            按当前主体重新检索
          </button>
        ) : null}
        {data.checks.map((c) => (
          <article key={c.id} className="border-t pt-2 text-xs">
            <b>{formatDateTime(c.checkedAt)} · {conflictConclusionLabel[c.conclusion]}{!c.current ? ' · 主体或范围已变化' : ''}</b>
            <p className="t-mute">{c.note} {c.decidedBy}</p>
            {c.hits.map((h) => (
              <p key={h.id} className="t-mute">{h.reason} · {h.matchedValue}</p>
            ))}
          </article>
        ))}
        {canWrite && latest?.current ? (
          <div className="space-y-2 border-t pt-2">
            <Textarea aria-label="冲突复核理由" placeholder="排除冲突的依据，或存在冲突后的处理措施" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
            <div className="flex flex-wrap gap-2">
              {(['DIFFERENT', 'SAME_SUBJECT', 'NEED_INFO'] as const).map((conclusion) => (
                <button key={conclusion} disabled={busy || !note.trim()} className="btn btn-secondary btn-sm" onClick={() => void run(() => decideMatterReview({ matterId, checkId: latest.id, conclusion, note }))}>
                  {conflictConclusionLabel[conclusion]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
