"use server";

import { requireSession } from "@/lib/auth/session";
import {
  searchLocalJudgments,
  checkLocalJudgmentService
} from "@/lib/cncases/client";
import { audit } from "@/server/audit";

export type LocalJudgmentSearchActionResult = {
  available: boolean;
  total: number;
  items: { title: string; href: string; meta?: string }[];
  message?: string;
};

/** 本地裁判文书检索（cncases 8500 万份，本地裁判文书数据盘 + 127.0.0.1:8081）。 */
export async function searchLocalJudgmentsAction(
  query: string,
  opts: { max?: number; matterId?: string } = {}
): Promise<LocalJudgmentSearchActionResult> {
  const session = await requireSession();
  const max = opts.max ?? 20;

  const health = await checkLocalJudgmentService();
  if (!health) {
    return {
      available: false,
      total: 0,
      items: [],
      message: "本地裁判文书服务未启动：请确认本地裁判文书数据盘已挂载、cncases 服务已运行"
    };
  }

  const res = await searchLocalJudgments(query, max);

  await audit({
    userId: session.user.id,
    action: "CNCASES_LOCAL_JUDGMENT_SEARCH",
    targetType: opts.matterId ? "Matter" : "SystemSetting",
    targetId: opts.matterId ?? "cncases",
    detail: { query, total: res.total, hits: res.items.length }
  }).catch(() => {});

  return res;
}
