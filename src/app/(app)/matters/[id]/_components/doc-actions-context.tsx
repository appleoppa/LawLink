"use client";

/**
 * 材料行的附加操作（AI 审查等）通过上下文下发，避免穿透多层工作区组件传参。
 * 未提供时 DocRow 不显示对应按钮（按配置与权限显示，不做假入口）。
 */
import { createContext, useContext } from "react";

export type DocActions = { onReview?: (documentId: string) => void };

export const DocActionsContext = createContext<DocActions>({});
export const useDocActions = () => useContext(DocActionsContext);
