"use client";

/**
 * 顶栏主操作随页面变化（墨案效果图：工作台「新建收案」、案件详情「登记进展」、
 * 财务「登记收付」、日程「新建任务」）。页面在挂载时注册自己的主操作，卸载时清除；
 * 未注册时顶栏回落为「新建收案」（仅对有收案权限的账号）。原则：一屏一个主操作，页头不重复顶栏已有的主操作。
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";

/** null = 使用默认「新建收案」；"none" = 本页页头已有主操作，顶栏不再重复 */
export type TopbarAction = { label: string; onClick: () => void; disabled?: boolean } | null | "none";

const Ctx = createContext<{ action: TopbarAction; setAction: (a: TopbarAction) => void }>({
  action: null,
  setAction: () => undefined
});

export function TopbarActionProvider({ children }: { children: React.ReactNode }) {
  const [action, setAction] = useState<TopbarAction>(null);
  const value = useMemo(() => ({ action, setAction }), [action]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTopbarActionValue() {
  return useContext(Ctx).action;
}

/** 页面注册顶栏主操作；传 null 表示使用默认 */
export function useTopbarAction(action: TopbarAction, deps: React.DependencyList = []) {
  const { setAction } = useContext(Ctx);
  useEffect(() => {
    setAction(action);
    return () => setAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
