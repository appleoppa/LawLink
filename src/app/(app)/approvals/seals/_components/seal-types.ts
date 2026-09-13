/**
 * /seals 页面共享类型（v0.8）
 */
import type { Prisma } from "@prisma/client";

export type SealRequestRow = Prisma.SealRequestGetPayload<{
  include: {
    matter: { select: { id: true; internalCode: true; title: true } };
    requestedBy: { select: { id: true; name: true } };
    approvedBy: { select: { id: true; name: true } };
    stampedByUser: { select: { id: true; name: true } };
    draftDoc: { select: { id: true; name: true; size: true } };
    stampedDoc: { select: { id: true; name: true; size: true } };
  };
}> & { canApprove?: boolean; canStamp?: boolean };

export type SealTypeConfigRow = Prisma.SealTypeConfigGetPayload<{}>;

export type MatterOption = {
  id: string;
  internalCode: string;
  title: string;
};

export const SEAL_TYPE_CN: Record<string, string> = {
  OFFICIAL_SEAL: "律所公章",
  CONTRACT_SEAL: "合同专用章",
  FINANCE_SEAL: "财务专用章",
  LEGAL_REP_SEAL: "法定代表人章",
  CONTRACT_REVIEW_SEAL: "合同审核章"
};

export const SEAL_STATUS_CN: Record<string, string> = {
  PENDING: "待审批",
  APPROVED: "待盖章",
  STAMPED: "已完成",
  REJECTED: "已驳回",
  CANCELLED: "已撤销"
};

export const SEAL_STATUS_COLOR: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  PENDING: {
    bg: "rgb(252 211 77 / 0.12)",
    text: "rgb(180 130 0)",
    border: "rgb(252 211 77 / 0.5)"
  },
  APPROVED: {
    bg: "rgb(96 165 250 / 0.12)",
    text: "rgb(37 99 235)",
    border: "rgb(96 165 250 / 0.5)"
  },
  STAMPED: {
    bg: "rgb(74 222 128 / 0.12)",
    text: "rgb(22 163 74)",
    border: "rgb(74 222 128 / 0.5)"
  },
  REJECTED: {
    bg: "rgb(248 113 113 / 0.12)",
    text: "rgb(220 38 38)",
    border: "rgb(248 113 113 / 0.5)"
  },
  CANCELLED: {
    bg: "rgb(156 163 175 / 0.12)",
    text: "rgb(107 114 128)",
    border: "rgb(156 163 175 / 0.5)"
  }
};
