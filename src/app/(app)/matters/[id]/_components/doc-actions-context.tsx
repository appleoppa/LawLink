"use client";

/**
 * 材料行的附加操作（AI 审查等）通过上下文下发，避免穿透多层工作区组件传参。
 * 未提供时 DocRow 不显示对应按钮（按配置与权限显示，不做假入口）。
 */
import { createContext, useContext } from "react";
import type { EvidenceItemRow } from "./evidence-panel";

export type DocActions = {
  onReview?: (documentId: string) => void;
  /** 材料行上的证据要点（按来源材料 id 分组） */
  evidenceByDoc?: Map<string, EvidenceItemRow[]>;
  /** 添加证据要点（docId 为 null 表示不挂材料） */
  onAddEvidence?: (documentId: string | null) => void;
  /** 未挂材料的证据要点（全部环节范围下展示） */
  unlinkedEvidence?: EvidenceItemRow[];
};

export const DocActionsContext = createContext<DocActions>({});
export const useDocActions = () => useContext(DocActionsContext);
