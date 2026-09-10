import type { MatterCategory, ProcedureType } from "@prisma/client";

export type CauseScope = {
  dbCategory: MatterCategory;
  includeCodePrefixes: readonly string[] | null;
  excludeCodePrefixes: readonly string[];
};

// 现行《仲裁法》(2025 修订，2026-03-01 施行)第三条：
// 平等主体之间的合同纠纷和其他财产权益纠纷可以仲裁；身份关系纠纷和行政争议不能仲裁。
export const COMMERCIAL_ARBITRATION_CAUSE_INCLUDE_PREFIXES = [
  "CC-3", // 物权纠纷
  "CC-4", // 合同、准合同纠纷
  "CC-5", // 知识产权与竞争纠纷
  "CC-6", // 数据、网络虚拟财产纠纷
  "CC-8", // 海事海商纠纷
  "CC-9" // 公司、证券、保险、票据等商事财产权益纠纷
] as const;

export const COMMERCIAL_ARBITRATION_CAUSE_EXCLUDE_PREFIXES = [
  "CC-3-7-65-3", // 土地承包经营权继承纠纷
  "CC-8-22-224", // 海上、通海水域人身损害责任纠纷
  "CC-8-22-236", // 船员劳动合同纠纷
  "CC-8-22-237", // 船员劳务派遣合同纠纷
  "CC-9-24-315", // 公司解散纠纷
  "CC-9-26-325", // 农民专业合作社解散纠纷
  "CC-9-26-326", // 农民专业合作社清算纠纷
  "CC-9-27" // 与破产有关的纠纷
] as const;

export function isCommercialArbitrationSelection(
  category: MatterCategory,
  procedureType?: ProcedureType | null
) {
  return category === "COMMERCIAL_ARBITRATION" || procedureType === "COMMERCIAL_ARBITRATION";
}

export function causeScopeForSelection(
  category: MatterCategory,
  procedureType?: ProcedureType | null
): CauseScope {
  if (isCommercialArbitrationSelection(category, procedureType)) {
    return {
      dbCategory: "CIVIL_COMMERCIAL",
      includeCodePrefixes: COMMERCIAL_ARBITRATION_CAUSE_INCLUDE_PREFIXES,
      excludeCodePrefixes: COMMERCIAL_ARBITRATION_CAUSE_EXCLUDE_PREFIXES
    };
  }

  if (category === "LABOR_ARBITRATION") {
    return {
      dbCategory: "CIVIL_COMMERCIAL",
      includeCodePrefixes: ["CC-7"],
      excludeCodePrefixes: []
    };
  }

  return { dbCategory: category, includeCodePrefixes: null, excludeCodePrefixes: [] };
}

export function causeCodeMatchesPrefix(code: string, prefix: string) {
  return code === prefix || code.startsWith(`${prefix}-`);
}

export function isCauseAllowedForSelection(
  cause: { category: MatterCategory; code: string | null; active?: boolean | null },
  category: MatterCategory,
  procedureType?: ProcedureType | null
) {
  const scope = causeScopeForSelection(category, procedureType);
  if (cause.category !== scope.dbCategory) return false;
  if (cause.active === false) return false;

  if (scope.includeCodePrefixes) {
    if (!cause.code) return false;
    if (!scope.includeCodePrefixes.some((prefix) => causeCodeMatchesPrefix(cause.code!, prefix))) {
      return false;
    }
  }

  if (cause.code && scope.excludeCodePrefixes.some((prefix) => causeCodeMatchesPrefix(cause.code!, prefix))) {
    return false;
  }

  return true;
}
