import type { MatterCategory, ProcedureType, LitigationStanding } from "@prisma/client";

/**
 * 各案件类别下可选的程序类型。
 * UI 上"新建案件"和"添加程序"按此表过滤可选项。
 */
export const proceduresByCategory: Record<MatterCategory, ProcedureType[]> = {
  CIVIL_COMMERCIAL: [
    "FIRST_INSTANCE",
    "SECOND_INSTANCE",
    "RETRIAL_REVIEW",
    "RETRIAL",
    "REMAND_FIRST",
    "REMAND_SECOND",
    "COMMERCIAL_ARBITRATION",
    "LABOR_ARBITRATION",
    "ARBITRATION_SET_ASIDE",
    "ARBITRATION_ENFORCEMENT_REVIEW",
    "ENFORCEMENT",
    "ENFORCEMENT_OBJECTION",
    "PROSECUTORIAL_SUPERVISION",
    "CUSTOM"
  ],
  CRIMINAL: [
    "INVESTIGATION",
    "PROSECUTION_REVIEW",
    "FIRST_INSTANCE",
    "SECOND_INSTANCE",
    "DEATH_PENALTY_REVIEW",
    "RETRIAL_REVIEW",
    "RETRIAL",
    "CRIMINAL_ENFORCEMENT",
    "COMMUTATION_PAROLE_REVIEW",
    "PROSECUTORIAL_SUPERVISION",
    "CUSTOM"
  ],
  ADMINISTRATIVE: [
    "ADMIN_RECONSIDERATION",
    "FIRST_INSTANCE",
    "SECOND_INSTANCE",
    "RETRIAL_REVIEW",
    "RETRIAL",
    "ADMIN_NON_LITIGATION_ENFORCEMENT",
    "PROSECUTORIAL_SUPERVISION",
    "CUSTOM"
  ],
  // 劳动仲裁前置，裁后不服可续一审/二审/再审/执行
  LABOR_ARBITRATION: [
    "LABOR_ARBITRATION",
    "FIRST_INSTANCE",
    "SECOND_INSTANCE",
    "RETRIAL_REVIEW",
    "RETRIAL",
    "ENFORCEMENT",
    "CUSTOM"
  ],
  // 商事仲裁一裁终局，但裁后仍可进入撤裁、不予执行审查、执行等程序
  COMMERCIAL_ARBITRATION: [
    "COMMERCIAL_ARBITRATION",
    "ARBITRATION_SET_ASIDE",
    "ARBITRATION_ENFORCEMENT_REVIEW",
    "ENFORCEMENT",
    "ENFORCEMENT_OBJECTION",
    "CUSTOM"
  ],
  NON_LITIGATION: ["NON_LITIGATION_PHASE", "CUSTOM"],
  LEGAL_COUNSEL: ["NON_LITIGATION_PHASE", "CUSTOM"],
  SPECIAL_PROJECT: ["NON_LITIGATION_PHASE", "CUSTOM"]
};

/**
 * 各案件类别下可选的诉讼地位（我方角色）。
 */
export const standingsByCategory: Record<MatterCategory, LitigationStanding[]> = {
  CIVIL_COMMERCIAL: [
    "PLAINTIFF",
    "DEFENDANT",
    "THIRD_PARTY",
    "ARBITRATION_CLAIMANT",
    "ARBITRATION_RESPONDENT"
  ],
  CRIMINAL: [
    "CRIMINAL_DEFENDANT",
    "CRIMINAL_VICTIM",
    "PRIVATE_PROSECUTOR",
    "CRIMINAL_INCIDENTAL_PLAINTIFF"
  ],
  ADMINISTRATIVE: ["PLAINTIFF", "DEFENDANT", "THIRD_PARTY"],
  LABOR_ARBITRATION: [
    "ARBITRATION_CLAIMANT",
    "ARBITRATION_RESPONDENT",
    "PLAINTIFF",
    "DEFENDANT",
    "THIRD_PARTY"
  ],
  COMMERCIAL_ARBITRATION: ["ARBITRATION_CLAIMANT", "ARBITRATION_RESPONDENT", "THIRD_PARTY"],
  NON_LITIGATION: ["NON_LITIGATION_PARTY"],
  LEGAL_COUNSEL: ["NON_LITIGATION_PARTY"],
  SPECIAL_PROJECT: ["NON_LITIGATION_PARTY"]
};

/**
 * 根据程序类型推荐"办理机关"的提示文本。
 */
export function suggestHandlingAgency(type: ProcedureType): string {
  if (type === "INVESTIGATION") return "公安局 / 监察委 / 国安局";
  if (type === "PROSECUTION_REVIEW") return "检察院（审查起诉部门）";
  if (type === "PROSECUTORIAL_SUPERVISION") return "检察院";
  if (type === "CRIMINAL_ENFORCEMENT") return "监狱 / 看守所 / 社区矫正机构";
  if (type === "COMMUTATION_PAROLE_REVIEW") return "法院（执行庭）";
  if (type === "ADMIN_RECONSIDERATION") return "复议机关";
  if (type === "COMMERCIAL_ARBITRATION") return "仲裁委员会";
  if (type === "LABOR_ARBITRATION") return "劳动人事争议仲裁委";
  if (type === "ARBITRATION_SET_ASIDE" || type === "ARBITRATION_ENFORCEMENT_REVIEW")
    return "中级人民法院";
  if (type === "ENFORCEMENT" || type === "ENFORCEMENT_OBJECTION") return "法院（执行局）";
  if (type === "ADMIN_NON_LITIGATION_ENFORCEMENT") return "法院";
  // 一审/二审/再审 等审判类
  return "法院";
}

export const matterCategoryCode: Record<MatterCategory, string> = {
  CIVIL_COMMERCIAL: "CC",
  LABOR_ARBITRATION: "LA",
  COMMERCIAL_ARBITRATION: "CA",
  CRIMINAL: "CR",
  ADMINISTRATIVE: "AD",
  NON_LITIGATION: "NL",
  LEGAL_COUNSEL: "GC",
  SPECIAL_PROJECT: "SP"
};
