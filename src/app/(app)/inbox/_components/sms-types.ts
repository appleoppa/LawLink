/**
 * /inbox 共享类型
 */
import type { Prisma, SmsType, ProcedureType } from "@prisma/client";
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

export const SMS_TYPE_ACCENT: Record<SmsType, string> = {
  HEARING_NOTICE: "#dc2626",
  SERVICE_NOTICE: "#0ea5e9",
  FEE_NOTICE: "#d97706",
  MEDIATION: "#0891b2",
  ENFORCEMENT: "#7c2d12",
  FILING_NOTICE: "#16a34a",
  JUDGMENT_NOTICE: "#7c3aed",
  EVIDENCE_SUBMIT: "#0d9488",
  OTHER: "#737373"
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
