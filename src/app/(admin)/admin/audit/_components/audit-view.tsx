"use client";

import { useState, useCallback, useTransition } from "react";
import { auditActionLabel, auditTargetLabel } from "@/lib/audit-labels";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { AdminPageHeader } from "@/components/layout/admin-page-header";

type AuditItem = {
  id: string;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  user: { id: string; name: string } | null;
};

const actionColor: Record<string, string> = {
  LOGIN: "#1E56C8",
  MATTER_CREATE: "#1A7F45",
  MATTER_CLOSE: "#96650B",
  MATTER_ARCHIVE: "#6C3FC5",
  MATTER_DELETE: "#B42318",
  CLIENT_CREATE: "#1A7F45",
  CLIENT_DELETE: "#B42318",
  CONFLICT_CHECK_RUN: "#96650B",
  FEE_ENTRY_CREATE: "#1A7F45",
  USER_CREATE: "#1A7F45",
  USER_DEACTIVATE: "#B42318",
  USER_PASSWORD_RESET: "#96650B"
};

function colorFor(action: string) {
  if (actionColor[action]) return actionColor[action];
  if (action.endsWith("_CREATE") || action.endsWith("_ADD")) return "#1A7F45";
  if (action.endsWith("_DELETE") || action.endsWith("_DEACTIVATE")) return "#B42318";
  if (action.endsWith("_UPDATE") || action.endsWith("_EDIT")) return "#96650B";
  if (action.endsWith("_VIEW")) return "#98A3AD";
  return "#1E56C8";
}

export function AuditView({
  items,
  distinctActions,
  userOptions,
  initialFilters
}: {
  items: AuditItem[];
  distinctActions: string[];
  userOptions: { id: string; name: string }[];
  initialFilters: { action: string; userId: string; days: string };
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [action, setAction] = useState(initialFilters.action);
  const [userId, setUserId] = useState(initialFilters.userId);
  const [days, setDays] = useState(initialFilters.days);

  const updateUrl = useCallback(
    (next: Partial<{ action: string; userId: string; days: string }>) => {
      const params = new URLSearchParams();
      const a = next.action ?? action;
      const u = next.userId ?? userId;
      const d = next.days ?? days;
      if (a && a !== "ALL") params.set("action", a);
      if (u && u !== "ALL") params.set("userId", u);
      if (d && d !== "30") params.set("days", d);
      startTransition(() => {
        router.replace(`/admin/audit${params.toString() ? `?${params.toString()}` : ""}`);
      });
    },
    [router, action, userId, days]
  );

  function reset() {
    setAction("ALL");
    setUserId("ALL");
    setDays("30");
    startTransition(() => router.replace("/admin/audit"));
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title="审计日志" sub={<>当前筛选下 <b>{items.length}</b> 条 · 敏感操作（明文查看、导出、权限变更）均在此留痕，不可删除</>} />

      <div className="flex flex-wrap items-center gap-3 card p-3">
        <Select
          value={action}
          onValueChange={(v) => {
            setAction(v);
            updateUrl({ action: v });
          }}
        >
          <SelectTrigger className="h-9 w-44 bg-background">
            <SelectValue placeholder="动作" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="ALL">全部动作</SelectItem>
            {distinctActions.map((a) => (
              <SelectItem key={a} value={a}>
                {auditActionLabel(a)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={userId}
          onValueChange={(v) => {
            setUserId(v);
            updateUrl({ userId: v });
          }}
        >
          <SelectTrigger className="h-9 w-40 bg-background">
            <SelectValue placeholder="用户" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部用户</SelectItem>
            {userOptions.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={days}
          onValueChange={(v) => {
            setDays(v);
            updateUrl({ days: v });
          }}
        >
          <SelectTrigger className="h-9 w-32 bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">近 7 天</SelectItem>
            <SelectItem value="30">近 30 天</SelectItem>
            <SelectItem value="90">近 90 天</SelectItem>
            <SelectItem value="365">近 1 年</SelectItem>
          </SelectContent>
        </Select>

        {(action !== "ALL" || userId !== "ALL" || days !== "30") && (
          <Button variant="ghost" size="sm" onClick={reset} className="gap-1">
            <RotateCcw className="h-3.5 w-3.5" />
            重置
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
          <p className="text-sm text-muted-foreground">没有匹配的审计记录</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => {
            const color = colorFor(it.action);
            return (
              <li
                key={it.id}
                className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-2.5"
              >
                <span
                  className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
                />
                <div className="flex-1 overflow-hidden">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px]"
                      style={{ borderColor: `${color}50`, color }}
                    >
                      {auditActionLabel(it.action)}
                    </Badge>
                    {it.targetType && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {auditTargetLabel(it.targetType)}
                      </span>
                    )}
                    {it.targetId && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {it.targetId.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <details className="mt-1 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">技术详情</summary>
                    <pre className="mt-1 max-h-48 overflow-auto font-mono text-[10px]">
                      {JSON.stringify({ action: it.action, targetType: it.targetType, detail: it.detail }, null, 2)}
                    </pre>
                  </details>
                </div>
                <div className="text-right text-xs">
                  <div>{it.user?.name ?? "—"}</div>
                  <div className="font-mono text-[10px] text-muted-foreground tabular">
                    {new Date(it.createdAt).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
