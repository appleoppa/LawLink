"use server";

/**
 * v0.28: 引导式 AI 文书起草（对照"案件云"的填空式文书起草）
 *
 * 用户在前端以"填空式"提供：文书类型 + 我方 / 对方 + 案件背景 + 诉讼请求，
 * 这里拼成结构化提示交给 aiChat，返回 Markdown 草稿，供前端预览 / 复制 / 下载。
 *
 * 原则：仅依据用户提供的信息起草，不臆造事实、证据与具体法条编号；
 * 信息缺失处用【】占位提示补充。生成结果仅为草稿，需律师核校。
 */
import { requireSession } from "@/lib/auth/session";
import { aiChat, AiNotConfiguredError } from "@/lib/ai/client";

export type DraftInput = {
  docType: string; // 文书类型，如"民事起诉状"
  selfParty?: string; // 我方当事人
  opposingParty?: string; // 对方当事人
  background?: string; // 案件背景
  claims?: string; // 诉讼请求 / 核心主张
  extra?: string; // 其他补充
};

export type DraftResult =
  | { ok: true; content: string }
  | { ok: false; reason: "not_configured" | "error"; message: string };

const SYSTEM_PROMPT = `你是一名资深中国执业律师，擅长起草各类法律文书。
请根据用户提供的信息，起草一份结构规范、用语专业的法律文书草稿，输出 Markdown 格式。
要求：
1. 严格遵循该类文书的通用格式（当事人信息栏、正文、诉讼请求/事实与理由、落款等）。
2. 只依据用户提供的信息撰写，不得臆造当事人身份信息、证据、金额或具体法条编号；信息缺失处用【】占位并提示补充。
3. 语言正式、逻辑清晰，事实与理由分点陈述。
4. 文末注明这是 AI 生成的草稿，需律师核校后使用。`;

export async function draftDocument(input: DraftInput): Promise<DraftResult> {
  await requireSession("documents.write");

  const docType = input.docType?.trim();
  if (!docType) {
    return { ok: false, reason: "error", message: "请先选择或填写文书类型" };
  }

  const lines = [`请起草一份「${docType}」。`];
  if (input.selfParty?.trim()) lines.push(`我方当事人：${input.selfParty.trim()}`);
  if (input.opposingParty?.trim()) lines.push(`对方当事人：${input.opposingParty.trim()}`);
  if (input.background?.trim()) lines.push(`案件背景：\n${input.background.trim()}`);
  if (input.claims?.trim()) lines.push(`诉讼请求 / 核心主张：\n${input.claims.trim()}`);
  if (input.extra?.trim()) lines.push(`其他补充：\n${input.extra.trim()}`);

  try {
    const { content } = await aiChat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: lines.join("\n\n") }
      ],
      maxTokens: 2800,
      temperature: 0.4
    });
    return { ok: true, content };
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return { ok: false, reason: "not_configured", message: err.message };
    }
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "生成失败，请稍后重试"
    };
  }
}
