"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { listTeams } from "@/server/teams/actions";
import { saveTeam } from "@/server/teams/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { AdminPageHeader } from "@/components/layout/admin-page-header";

type Team = Awaited<ReturnType<typeof listTeams>>[number];
type User = { id: string; name: string; role: string; active: boolean };

export function TeamsView({ teams, users }: { teams: Team[]; users: User[] }) {
  const [editor, setEditor] = useState<Team | "new" | null>(null);
  return <div className="space-y-4">
    <AdminPageHeader title="律师团队" sub="设置成员后，负责人自动看到成员立案或主办的全部案件。" actions={<Button size="sm" onClick={() => setEditor("new")}><Plus />新建团队</Button>} />
    {teams.length === 0 ? <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">暂无律师团队。先创建团队，再指定负责人和成员。</div> :
      <div className="divide-y rounded-xl border bg-card">{teams.map((team) => <article key={team.id} className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{team.name}</h3><Badge variant={team.active ? "secondary" : "outline"}>{team.active ? "使用中" : "已停用"}</Badge></div>
          <p className="text-sm text-muted-foreground">负责人：{team.leader.name} · {team.members.length} 位成员</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{team.members.map((m) => `${m.user.name}${m.userId === team.leaderId ? "（负责人）" : m.canViewAllMatters ? "（团队查看）" : ""}${!m.user.active ? "（账号停用）" : ""}`).join("、")}</p>
        </div><Button variant="ghost" size="sm" onClick={() => setEditor(team)} aria-label={`编辑${team.name}`}><Pencil className="mr-1 h-3.5 w-3.5" />编辑</Button>
      </article>)}</div>}
    {editor && <TeamEditor key={editor === "new" ? "new" : editor.id} team={editor === "new" ? null : editor} users={users} onClose={() => setEditor(null)} />}
  </div>;
}

function TeamEditor({ team, users, onClose }: { team: Team | null; users: User[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(team?.name ?? "");
  const [leaderId, setLeaderId] = useState(team?.leaderId ?? "");
  const [active, setActive] = useState(team?.active ?? true);
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState<Record<string, boolean>>(() => Object.fromEntries((team?.members ?? []).map((m) => [m.userId, m.canViewAllMatters])));
  const [error, setError] = useState("");
  const selected = { ...members, ...(leaderId ? { [leaderId]: true } : {}) };
  const candidates = users.filter((u) => (u.active || u.id in selected) && (u.name.includes(search.trim()) || u.id in selected));
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        await saveTeam({ id: team?.id, expectedUpdatedAt: team?.updatedAt, name, leaderId, active,
          members: Object.entries(selected).map(([userId, canViewAllMatters]) => ({ userId, canViewAllMatters })) });
        toast.success(team ? "团队设置已更新" : "团队已创建");
        // 撤权复核提示（2026-09-13 制度决策）：移出成员/更换负责人/停用团队时提示复核，不阻塞保存
        if (team) {
          const removed = team.members.filter(m => !(m.userId in selected) || (m.userId === team.leaderId && m.userId !== leaderId));
          const deactivated = team.active && !active;
          const leaderChanged = team.leaderId !== leaderId;
          if (deactivated || leaderChanged || removed.length > 0) {
            toast.info("团队访问已即时调整", {
              description: "该成员经团队汇总可见的历史案件访问即时停止；如有仍需其访问的受限案件，请另行复核授权。"
            });
          }
        }
        router.refresh();
        onClose();
      } catch (err) { setError(err instanceof Error ? err.message : "保存失败，请稍后重试"); }
    });
  }
  return <Sheet open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <SheetContent className="flex w-full flex-col sm:max-w-xl">
      <SheetHeader><SheetTitle>{team ? "编辑律师团队" : "新建律师团队"}</SheetTitle><SheetDescription>负责人和获授权成员可查看整个团队的案件，业务经办权限保持独立。</SheetDescription></SheetHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <fieldset disabled={pending} className="min-h-0 flex-1 space-y-5 overflow-y-auto py-5">
          <div className="space-y-2"><Label htmlFor="team-name">团队名称</Label><Input id="team-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：商事争议团队" /></div>
          <div className="space-y-2"><Label htmlFor="team-leader">团队负责人</Label><Select value={leaderId} onValueChange={(id) => { setLeaderId(id); setMembers((current) => ({ ...current, ...(leaderId ? { [leaderId]: false } : {}), [id]: true })); }}><SelectTrigger id="team-leader"><SelectValue placeholder="选择负责人" /></SelectTrigger><SelectContent>{users.filter((u) => u.active && ["PRINCIPAL_LAWYER", "LAWYER"].includes(u.role)).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select></div>
          <section className="space-y-2"><h3 className="text-sm font-medium">团队成员 · {Object.keys(selected).length} 人</h3><p className="text-xs leading-relaxed text-muted-foreground">负责人自动加入。勾选“查看团队案件”可为其他成员开放团队查看权限。</p>
            <Input aria-label="搜索团队成员" placeholder="搜索姓名（保留已选成员）" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="divide-y rounded-lg border">{candidates.map((u) => <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <label className="flex items-center gap-2 text-sm"><Checkbox disabled={u.id === leaderId} checked={u.id in selected} onCheckedChange={(checked) => setMembers((current) => { const next = { ...current }; if (checked === true) next[u.id] = false; else delete next[u.id]; return next; })} />{u.name}{u.id === leaderId ? "（负责人）" : !u.active ? "（账号停用）" : ""}</label>
              {u.id in selected && <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Checkbox disabled={u.id === leaderId} checked={selected[u.id]} onCheckedChange={(checked) => setMembers((current) => ({ ...current, [u.id]: checked === true }))} />查看团队案件</label>}
            </div>)}{candidates.length === 0 && <p className="p-4 text-sm text-muted-foreground">没有匹配的人员</p>}</div>
          </section>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={active} onCheckedChange={(checked) => setActive(checked === true)} />启用团队</label>
          <p className="text-xs leading-relaxed text-muted-foreground">移出成员或停用团队后，团队查看范围立即调整，个人已有经办权限保留；保存后如涉及成员移出、负责人更换或停用，将提示复核受限案件访问。</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </fieldset>
        <SheetFooter className="border-t pt-4"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>取消</Button><Button type="submit" disabled={pending || !name.trim() || !leaderId}>{pending ? "正在保存…" : "保存团队"}</Button></SheetFooter>
      </form>
    </SheetContent>
  </Sheet>;
}
