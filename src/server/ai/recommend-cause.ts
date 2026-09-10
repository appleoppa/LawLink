"use server";

/**
 * v0.19: 案由 AI 推荐
 *
 * 输入案情描述 → LLM 吐 3 个 4 级案由名 + 推荐理由 + 置信度
 * → 用 searchCauses 反查库内 id（找不到的丢弃）
 * → 返回带库内 cause 对象的候选列表
 */
import type { MatterCategory, ProcedureType } from "@prisma/client";
import { aiChat, extractJson, AiNotConfiguredError } from "@/lib/ai/client";
import { searchCauses, type CauseSearchResult } from "@/server/causes/actions";
import { requireSession } from "@/lib/auth/session";

export type CauseConfidence = "HIGH" | "MEDIUM" | "LOW";

export type CauseRecommendation = {
  cause: CauseSearchResult;
  reason: string;
  confidence: CauseConfidence;
};

type LlmCandidate = {
  name?: unknown;
  reason?: unknown;
  confidence?: unknown;
};

const SYSTEM_PROMPT = `你是中国法律案由分类助手。
基于用户给出的案件类别和案情描述，从《民事案件案由规定》/《行政案件案由规定》/刑事罪名体系中
选出最贴近的 3 个**最末级**（三级或四级）案由。

严格按下方 JSON 数组返回（仅 JSON，不要任何解释文字）：
[
  {"name": "案由全名（如：民间借贷纠纷）", "reason": "为什么贴合本案，30 字内", "confidence": "HIGH" | "MEDIUM" | "LOW"},
  ...
]

规则：
- 必须返回 3 条；按相关度从高到低排序
- 案由名必须使用规范全称（如「民间借贷纠纷」而非「借贷」「借贷纠纷」）
- 优先选最末级具体案由，避免「合同纠纷」这种二级笼统分类
- confidence 自评：HIGH=案情要素完全对应；MEDIUM=主要要素匹配但有歧义；LOW=信息不足只能猜测`;

function categoryHint(category: MatterCategory): string {
  switch (category) {
    case "CIVIL_COMMERCIAL":
      return "民商事";
    case "CRIMINAL":
      return "刑事";
    case "ADMINISTRATIVE":
      return "行政";
    case "NON_LITIGATION":
      return "非诉";
    case "LEGAL_COUNSEL":
      return "常年法律顾问";
    case "SPECIAL_PROJECT":
      return "专项";
    default:
      return category;
  }
}

function normalizeConfidence(v: unknown): CauseConfidence {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  if (s === "HIGH" || s === "MEDIUM" || s === "LOW") return s;
  return "MEDIUM";
}

/**
 * 反查：把 LLM 给的案由名映射到库内记录。
 * - 优先精确匹配 name
 * - 否则取 searchCauses 返回的第一条
 * - 过滤掉 level < 3 的（二级太笼统，宁可不推）
 */
async function resolveCauseId(
  category: MatterCategory,
  procedureType: ProcedureType | null | undefined,
  rawName: string
): Promise<CauseSearchResult | null> {
  const name = rawName.trim();
  if (!name) return null;
  const hits = await searchCauses({ category, procedureType, query: name, limit: 10 });
  if (hits.length === 0) return null;
  const exact = hits.find((h) => h.name === name && h.level >= 3);
  if (exact) return exact;
  const leaf = hits.find((h) => h.level >= 3);
  return leaf ?? null;
}

export async function recommendCause(input: {
  category: MatterCategory;
  procedureType?: ProcedureType | null;
  situation: string;
}): Promise<CauseRecommendation[]> {
  await requireSession();

  const situation = input.situation.trim();
  if (situation.length < 5) {
    throw new Error("案情描述太短，至少 5 个字");
  }

  let content = "";
  try {
    const res = await aiChat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `案件类别：${categoryHint(input.category)}\n\n案情：\n${situation.slice(0, 4000)}`
        }
      ],
      maxTokens: 800,
      temperature: 0.1
    });
    content = res.content;
  } catch (err) {
    if (err instanceof AiNotConfiguredError) throw err;
    throw new Error(err instanceof Error ? err.message : "AI 请求失败");
  }

  const parsed = extractJson<LlmCandidate[]>(content);
  if (!Array.isArray(parsed)) {
    throw new Error("AI 返回内容无法解析为候选列表");
  }

  const results: CauseRecommendation[] = [];
  for (const item of parsed.slice(0, 5)) {
    const name = typeof item.name === "string" ? item.name : "";
    const reason = typeof item.reason === "string" ? item.reason : "";
    const confidence = normalizeConfidence(item.confidence);
    const cause = await resolveCauseId(input.category, input.procedureType, name);
    if (!cause) continue;
    if (results.some((r) => r.cause.id === cause.id)) continue;
    results.push({ cause, reason, confidence });
    if (results.length >= 3) break;
  }

  if (results.length === 0) {
    throw new Error("AI 推荐的案由都不在案由库中，请手动选择");
  }

  return results;
}
