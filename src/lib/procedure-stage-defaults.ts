import type { ProcedureType } from "@prisma/client";

export type StagePresetKind = "required" | "optional";

export type ProcedureStagePreset = {
  name: string;
  kind: StagePresetKind;
  description: string;
};

const CIVIL_TRIAL_PRESETS: ProcedureStagePreset[] = [
  { name: "代理授权", kind: "required", description: "委托手续、授权文件、律所函、风险告知和材料交接。" },
  { name: "案情研判", kind: "required", description: "事实梳理、证据缺口、法律检索和诉讼方案。" },
  { name: "起诉立案", kind: "required", description: "起诉/应诉材料、主体身份、管辖材料、缴费和诉调衔接。" },
  { name: "财产保全", kind: "optional", description: "保全申请、担保、裁定、续保和解除。" },
  { name: "管辖权异议", kind: "optional", description: "管辖异议申请或答辩、裁定签收和上诉衔接。" },
  { name: "举证质证", kind: "required", description: "举证期限、证据交换、补充证据和质证意见。" },
  { name: "司法鉴定", kind: "optional", description: "鉴定事项、样本材料、鉴定机构和鉴定意见质证。" },
  { name: "庭前会议", kind: "optional", description: "庭前会议通知、争点确认、证据交换和程序安排。" },
  { name: "模拟法庭", kind: "optional", description: "争点清单、发问提纲、攻防演练和客户庭前沟通。" },
  { name: "开庭审理", kind: "required", description: "传票、庭审提纲、发问提纲、证据原件和庭审记录。" },
  { name: "庭后补充", kind: "optional", description: "庭后代理意见、补充证据、庭审报告和法官沟通。" },
  { name: "裁判签收", kind: "required", description: "裁判文书签收、上诉期、履行期和裁判结果报告。" },
  { name: "上诉/二审衔接", kind: "optional", description: "是否上诉、二审委托、上诉材料和二审策略。" },
  { name: "案件归档", kind: "required", description: "结案报告、材料完整性、原件退还和归档申请。" }
];

const SECOND_INSTANCE_PRESETS: ProcedureStagePreset[] = [
  { name: "代理授权", kind: "required", description: "二审委托手续、授权文件和材料接收。" },
  { name: "上诉/应诉", kind: "required", description: "上诉状、答辩状、二审证据和上诉费。" },
  { name: "二审阅卷研判", kind: "required", description: "一审卷宗、裁判争点、二审代理思路和证据补强。" },
  { name: "财产保全", kind: "optional", description: "二审阶段保全、续保或解除衔接。" },
  { name: "管辖权异议", kind: "optional", description: "二审程序中的管辖或移送争议处理。" },
  { name: "举证质证", kind: "required", description: "二审新证据、补充证据和质证意见。" },
  { name: "司法鉴定", kind: "optional", description: "二审鉴定申请、补充鉴定或鉴定意见质证。" },
  { name: "模拟法庭", kind: "optional", description: "二审争点攻防、发问提纲和客户庭前演练。" },
  { name: "开庭/询问", kind: "required", description: "开庭、询问或书面审理准备与记录。" },
  { name: "庭后补充", kind: "optional", description: "庭后补充意见、补交材料和法官沟通。" },
  { name: "二审裁判", kind: "required", description: "二审裁判签收、生效、履行和后续程序提示。" },
  { name: "案件归档", kind: "required", description: "二审结案报告、材料归档和原件退还。" }
];

const ENFORCEMENT_PRESETS: ProcedureStagePreset[] = [
  { name: "代理授权", kind: "required", description: "执行阶段委托手续和材料交接。" },
  { name: "执行立案", kind: "required", description: "强制执行申请、生效证明、账户信息和立案材料。" },
  { name: "财产保全", kind: "optional", description: "已保全财产续保、解除或后续处置。" },
  { name: "财产查控", kind: "required", description: "财产线索、网络查控、查封冻结和处置跟进。" },
  { name: "异议/复议", kind: "optional", description: "执行异议、复议、不予执行和听证准备。" },
  { name: "执行和解", kind: "optional", description: "和解方案、协议签署、履行监督和恢复执行预案。" },
  { name: "执行结案", kind: "required", description: "执行回款、终本/终结、结案文书和后续安排。" },
  { name: "案件归档", kind: "required", description: "执行结案报告、材料归档和原件退还。" }
];

const ARBITRATION_PRESETS: ProcedureStagePreset[] = [
  { name: "代理授权", kind: "required", description: "仲裁委托手续、授权文件和材料交接。" },
  { name: "案情研判", kind: "required", description: "事实梳理、证据缺口、法律检索和仲裁方案。" },
  { name: "仲裁立案", kind: "required", description: "仲裁申请、主体材料、证据目录和仲裁费缴纳。" },
  { name: "财产保全", kind: "optional", description: "仲裁保全、担保、法院协助执行和续保。" },
  { name: "管辖权异议", kind: "optional", description: "仲裁管辖异议、仲裁协议效力和程序抗辩。" },
  { name: "举证质证", kind: "required", description: "证据交换、补充证据和质证意见。" },
  { name: "司法鉴定", kind: "optional", description: "鉴定申请、样本材料、鉴定机构和鉴定意见质证。" },
  { name: "模拟法庭", kind: "optional", description: "仲裁庭审攻防、发问提纲和客户庭前演练。" },
  { name: "开庭审理", kind: "required", description: "开庭通知、庭审提纲、发问提纲和原件核对。" },
  { name: "庭后补充", kind: "optional", description: "庭后补充意见、补交材料和仲裁庭沟通。" },
  { name: "仲裁裁决", kind: "required", description: "裁决签收、履行、撤裁评估和后续程序提示。" },
  { name: "案件归档", kind: "required", description: "仲裁结案报告、材料归档和原件退还。" }
];

const CRIMINAL_INVESTIGATION_PRESETS: ProcedureStagePreset[] = [
  { name: "代理授权", kind: "required", description: "刑事委托手续、授权材料和会见手续。" },
  { name: "会见", kind: "required", description: "会见预约、会见笔录、家属沟通和风险提示。" },
  { name: "取保候审", kind: "optional", description: "取保评估、申请材料、保证方式和办案机关沟通。" },
  { name: "阅卷线索", kind: "required", description: "事实线索、证据风险、补充材料和调查方向。" },
  { name: "辩护意见", kind: "required", description: "侦查阶段法律意见、羁押必要性意见和沟通留痕。" },
  { name: "案件归档", kind: "required", description: "阶段性报告、材料归档和后续程序衔接。" }
];

const NON_LITIGATION_PRESETS: ProcedureStagePreset[] = [
  { name: "委托确认", kind: "required", description: "委托合同、服务范围、交付标准和费用安排。" },
  { name: "需求梳理", kind: "required", description: "客户目标、交易背景、资料清单和关键时间节点。" },
  { name: "资料收集", kind: "required", description: "客户提供材料、公开检索、调档和资料缺口跟进。" },
  { name: "法律审查", kind: "required", description: "尽职调查、合同审查、法律检索和风险分析。" },
  { name: "沟通谈判", kind: "optional", description: "交易对方沟通、谈判要点、会议纪要和让步记录。" },
  { name: "文书起草", kind: "required", description: "法律意见书、报告、合同文本和修改说明。" },
  { name: "成果交付", kind: "required", description: "交付成果、客户确认、反馈意见和后续事项。" },
  { name: "服务总结", kind: "optional", description: "年度/阶段服务总结、工作量统计和续约建议。" },
  { name: "案件归档", kind: "required", description: "服务成果、往来文件和委托材料归档。" }
];

const PROSECUTION_REVIEW_PRESETS: ProcedureStagePreset[] = [
  { name: "代理授权", kind: "required", description: "审查起诉阶段委托手续、授权材料和会见手续。" },
  { name: "会见", kind: "required", description: "会见预约、会见笔录、家属沟通和权利告知。" },
  { name: "阅卷", kind: "required", description: "申请阅卷、卷宗摘录、证据审查和事实梳理。" },
  { name: "羁押必要性审查", kind: "optional", description: "羁押必要性审查申请、取保候审和变更强制措施。" },
  { name: "退回补充侦查", kind: "optional", description: "退补提纲、补充证据审查和期限重新计算。" },
  { name: "辩护意见", kind: "required", description: "不起诉/从轻意见、认罪认罚沟通和意见提交。" },
  { name: "审查结论", kind: "required", description: "起诉、不起诉决定签收和后续程序衔接。" },
  { name: "案件归档", kind: "required", description: "阶段辩护报告、材料归档和后续程序提示。" }
];

const ADMIN_RECONSIDERATION_PRESETS: ProcedureStagePreset[] = [
  { name: "代理授权", kind: "required", description: "复议委托手续、授权文件和材料交接。" },
  { name: "案情研判", kind: "required", description: "行政行为梳理、复议期限、法律依据和复议方案。" },
  { name: "复议申请", kind: "required", description: "复议申请书、主体材料、证据目录和提交回执。" },
  { name: "补正/答复", kind: "optional", description: "补正通知、被申请人答复和证据交换。" },
  { name: "听证", kind: "optional", description: "听证通知、陈述意见和听证笔录。" },
  { name: "复议决定", kind: "required", description: "复议决定签收、起诉期限和后续救济评估。" },
  { name: "案件归档", kind: "required", description: "复议结案报告、材料归档和原件退还。" }
];

export function procedureStagePresetsForProcedure(type: ProcedureType): ProcedureStagePreset[] {
  if (type === "SECOND_INSTANCE" || type === "REMAND_SECOND") return SECOND_INSTANCE_PRESETS;
  if (type === "ENFORCEMENT" || type === "ENFORCEMENT_OBJECTION") return ENFORCEMENT_PRESETS;
  if (type === "COMMERCIAL_ARBITRATION" || type === "LABOR_ARBITRATION") return ARBITRATION_PRESETS;
  if (type === "INVESTIGATION") return CRIMINAL_INVESTIGATION_PRESETS;
  if (type === "PROSECUTION_REVIEW") return PROSECUTION_REVIEW_PRESETS;
  if (type === "ADMIN_RECONSIDERATION") return ADMIN_RECONSIDERATION_PRESETS;
  if (type === "NON_LITIGATION_PHASE") return NON_LITIGATION_PRESETS;
  return CIVIL_TRIAL_PRESETS;
}

export function defaultStageNamesForProcedure(type: ProcedureType) {
  return procedureStagePresetsForProcedure(type)
    .filter((preset) => preset.kind === "required")
    .map((preset) => preset.name);
}

export function optionalStagePresetsForProcedure(type: ProcedureType) {
  return procedureStagePresetsForProcedure(type).filter((preset) => preset.kind === "optional");
}

export function normalizeProcedureStageName(name: string) {
  return name.trim().replace(/\s+/g, "");
}

export function stagePresetForName(type: ProcedureType, name: string) {
  const normalizedName = normalizeProcedureStageName(name);
  return procedureStagePresetsForProcedure(type).find(
    (preset) => normalizeProcedureStageName(preset.name) === normalizedName
  );
}
