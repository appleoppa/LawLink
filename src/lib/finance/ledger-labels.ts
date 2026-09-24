export const moneyKinds = ["LAWYER_FEE", "CLIENT_FUNDS", "EXPENSE_RECOVERY", "OTHER"] as const;
export type MoneyKind = typeof moneyKinds[number];
export const moneyKindLabels: Record<MoneyKind, string> = { LAWYER_FEE: "律师费", CLIENT_FUNDS: "代收款", EXPENSE_RECOVERY: "代垫回收", OTHER: "其他款项" };
export const dueLabels = { CONDITIONAL: "条件待成就", UNKNOWN: "未约定到期日", OVERDUE: "已逾期", NOT_DUE: "未到期" };
