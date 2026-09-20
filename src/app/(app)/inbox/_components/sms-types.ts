/**
 * /inbox 共享类型
 */
import type { Prisma, SmsType, ProcedureType, SmsProcessingState, SmsFileState, SmsFileSource } from "@prisma/client";
import type {
  SmsAttachmentResult,
  SmsCredential,
  SmsDocumentLink,
  SmsImportantItem
} from "@/lib/sms-parser";

export type SmsRow = Prisma.SmsMessageGetPayload<{
  include: {
    receivedBy: { select: { id: true; name: true } };
    matchedMatter: {
      select: {
        id: true;
        internalCode: true;
        title: true;
        procedures: {
          select: { id: true; type: true; customLabel: true; caseNumber: true };
        };
      };
    };
    inboundFiles: {
      select: { id: true; originalName: true; displayName: true; mimeType: true; size: true; state: true; uploadSource: true; downloadedAt: true; documentId: true; sourceUrl: true; analysisState: true; docType: true; analysisError: true };
    };
    suggestions: {
      select: { id: true; kind: true; fieldKey: true; currentValue: true; suggestedValue: true; sourcePage: true; sourceExcerpt: true; status: true; fileId: true; payload: true };
    };
  };
}>;

export type MatterOption = {
  id: string;
  internalCode: string;
  title: string;
  procedures: {
    id: string;
    type: ProcedureType;
    customLabel: string | null;
    caseNumber: string | null;
  }[];
};

export const SMS_TYPE_CN: Record<SmsType, string> = {
  HEARING_NOTICE: "开庭通知",
  SERVICE_NOTICE: "送达通知",
  FEE_NOTICE: "缴费通知",
  MEDIATION: "调解通知",
  ENFORCEMENT: "执行通知",
  FILING_NOTICE: "立案通知",
  JUDGMENT_NOTICE: "判决通知",
  EVIDENCE_SUBMIT: "提交材料",
  OTHER: "其他通知"
};

/** B1 来件处理状态（docs/SMS-B1-DESIGN-20260920.md §2.3） */
export const SMS_STATE_CN: Record<SmsProcessingState, string> = {
  PROCESSING: "取件中",
  NEEDS_MANUAL_FETCH: "待人工取件",
  NEEDS_MATCH: "待匹配案件",
  PARTIAL: "部分完成",
  READY_FOR_REVIEW: "待处理",
  ORGANIZED: "已整理",
  NO_ACTION_NEEDED: "无需处理"
};

export const SMS_STATE_ACCENT: Record<SmsProcessingState, string> = {
  PROCESSING: "#0ea5e9",
  NEEDS_MANUAL_FETCH: "#B42318",
  NEEDS_MATCH: "#96650B",
  PARTIAL: "#96650B",
  READY_FOR_REVIEW: "#68747F",
  ORGANIZED: "#1A7F45",
  NO_ACTION_NEEDED: "#1A7F45"
};

export const SMS_FILE_STATE_CN: Record<SmsFileState, string> = {
  PENDING_REVIEW: "待确认",
  FILED: "已入卷",
  FAILED: "取件失败",
  SUPERSEDED: "已替代"
};

export const SMS_FILE_SOURCE_CN: Record<SmsFileSource, string> = {
  LINK_FETCH: "自动取件",
  MANUAL_UPLOAD: "人工补传"
};

export const SMS_TYPE_ACCENT: Record<SmsType, string> = {
  HEARING_NOTICE: "#B42318",
  SERVICE_NOTICE: "#0ea5e9",
  FEE_NOTICE: "#96650B",
  MEDIATION: "#0891b2",
  ENFORCEMENT: "#7c2d12",
  FILING_NOTICE: "#1A7F45",
  JUDGMENT_NOTICE: "#7c3aed",
  EVIDENCE_SUBMIT: "#0d9488",
  OTHER: "#68747F"
};

// 解析结果结构（与 lib/sms-parser.ts ParsedSms 对齐）
export type ParsedJson = {
  smsType: SmsType;
  caseNumbers: string[];
  court: string | null;
  dates: string[];
  hearingDate: string | null;
  filingDate: string | null;
  judgmentDate: string | null;
  appealDeadline: string | null;
  courtRoom: string | null;
  judge: string | null;
  clerk: string | null;
  phones: string[];
  amounts: string[];
  urls: string[];
  platforms: string[];
  importantItems: SmsImportantItem[];
  credentials: SmsCredential[];
  documentLinks: SmsDocumentLink[];
  attachmentResults: SmsAttachmentResult[];
  summary: string;
  // v0.9.1 AI 增强字段
  aiEnriched?: boolean;
  action?: string | null;
  urgency?: "HIGH" | "MEDIUM" | "LOW" | null;
};

/** B2/B3：整理建议（docs/SYSTEM-AUDIT-REMEDIATION-V3 §3.2） */
export const SMS_SUGGESTION_CN: Record<string, string> = {
  FIELD_CHANGE: "档案修正",
  HEARING: "登记开庭",
  DEADLINE: "建立期限",
  MATTER_MATCH: "归属案件",
  DOC_TYPE: "文书分类"
};

export const SMS_ANALYSIS_CN: Record<string, string> = {
  PENDING: "待分析",
  ANALYZING: "分析中",
  ANALYZED: "已阅读",
  NEEDS_OCR: "需人工（无 OCR）",
  FAILED: "分析失败"
};
