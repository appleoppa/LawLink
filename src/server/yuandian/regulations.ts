"use server";

import { requireSession } from "@/lib/auth/session";
import {
  searchRegulations,
  YuandianNotConfiguredError,
  type RegulationHit
} from "@/lib/yuandian/client";
import { getYuandianSettings } from "@/lib/yuandian/settings";
import { audit } from "@/server/audit";

export type RegulationSearchHit = RegulationHit & { detailUrl?: string };

export async function searchRegulationsAction(
  params: {
    keyword?: string;
    fgmc?: string;
    xljb_1?: string;
    sxx?: string;
    top_k?: number;
    matterId?: string;
  }
): Promise<{ total: number; items: RegulationSearchHit[] }> {
  const session = await requireSession();

  const settings = await getYuandianSettings();
  if (!settings.configured) throw new YuandianNotConfiguredError();

  const { matterId, ...searchParams } = params;
  const res = await searchRegulations(searchParams, settings);

  await audit({
    userId: session.user.id,
    action: "YUANDIAN_REGULATION_SEARCH",
    targetType: matterId ? "Matter" : "SystemSetting",
    targetId: matterId ?? "yuandianSettings",
    detail: {
      keyword: searchParams.keyword,
      fgmc: searchParams.fgmc,
      xljb_1: searchParams.xljb_1,
      sxx: searchParams.sxx,
      total: res.total,
      hits: res.items.length
    }
  });

  return res;
}
