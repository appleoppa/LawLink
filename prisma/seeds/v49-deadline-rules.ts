/**
 * v0.49 法定期限规则库内置 seed（PRD §二十）。
 *
 * 铁律：每条规则的 legalBasis 必须经元典核验（rh_ft_search / rh_ft_detail）
 * 且现行有效，verifiedAt 记录核验日期；未核验的规则不允许加入本文件。
 * 本批 12 条于 2026-07-04 核验。
 *
 * 2026-09-21 增补 4 条（第六轮体检 P2-4，律师执业风险最高的两类期限补齐）：
 * - 诉讼时效（LIMITATION）：《民法典》第一百八十八条（三年普通时效自知道或
 *   应当知道之日起算；二十年最长保护期自权利受损之日起算），经司法部公布
 *   民法典全文复核 + 第六轮体检北大法宝核验，现行有效；
 * - 举证期限（EVIDENCE）：法院指定、因案而异，法律只定下限（一审普通程序
 *   ≥15 日、二审新证据 ≥10 日，《民诉法解释》第九十九条及 2019 修正《民事
 *   证据规定》延续），规则按下限推算默认值并明示「以法院通知书为准」。
 */
import type {
  DeadlineCategory,
  DeadlinePeriodUnit,
  MatterCategory,
  PrismaClient,
  ProcedureType
} from "@prisma/client";

const VERIFIED_AT = new Date("2026-07-04");
const VERIFIED_AT_P24 = new Date("2026-09-21");
const CIVIL_CODE_URL = "https://www.moj.gov.cn/pub/sfbgw/zwgkztzl/2025nianzhuanti/2025mfdxcy/2025mfdxcy_mfdql/202505/t20250507_518708.html";
const CPL_URL = "https://ydzk.chineselaw.com/zxt/statuteDetail/detailPage/f1b65a4dca3d6472206978435e2ea215";
const EVIDENCE_RULES_URL = "https://ipc.court.gov.cn";

type RuleSeed = {
  code: string;
  name: string;
  description?: string;
  triggerLabel: string;
  periodValue: number;
  periodUnit: DeadlinePeriodUnit;
  category: DeadlineCategory;
  legalBasis: string;
  legalBasisUrl: string;
  applicableProcedures: ProcedureType[];
  applicableCategories: MatterCategory[];
  remindDays: number;
  sortOrder: number;
};

const P24_CODES = new Set(["CIVIL_LIMITATION_GENERAL", "CIVIL_LIMITATION_MAX", "EVIDENCE_DEADLINE_FIRST", "EVIDENCE_DEADLINE_SECOND"]);

export const deadlineRuleSeeds: RuleSeed[] = [
  {
    code: "CIVIL_APPEAL_JUDGMENT",
    name: "民事上诉期（不服一审判决）",
    description: "不服地方人民法院第一审判决，向上一级人民法院提起上诉。",
    triggerLabel: "判决书送达之日",
    periodValue: 15,
    periodUnit: "DAYS",
    category: "APPEAL",
    legalBasis: "《中华人民共和国民事诉讼法（2023修正）》第一百七十一条",
    legalBasisUrl: `${CPL_URL}?text=171`,
    applicableProcedures: ["FIRST_INSTANCE", "REMAND_FIRST"],
    applicableCategories: ["CIVIL_COMMERCIAL"],
    remindDays: 7,
    sortOrder: 10
  },
  {
    code: "CIVIL_APPEAL_RULING",
    name: "民事上诉期（不服一审裁定）",
    description: "不服地方人民法院第一审裁定，向上一级人民法院提起上诉。",
    triggerLabel: "裁定书送达之日",
    periodValue: 10,
    periodUnit: "DAYS",
    category: "APPEAL",
    legalBasis: "《中华人民共和国民事诉讼法（2023修正）》第一百七十一条",
    legalBasisUrl: `${CPL_URL}?text=171`,
    applicableProcedures: ["FIRST_INSTANCE", "REMAND_FIRST"],
    applicableCategories: ["CIVIL_COMMERCIAL"],
    remindDays: 5,
    sortOrder: 20
  },
  {
    code: "CIVIL_DEFENSE_FIRST",
    name: "一审答辩期",
    description: "被告应当在收到起诉状副本之日起十五日内提出答辩状。",
    triggerLabel: "收到起诉状副本之日",
    periodValue: 15,
    periodUnit: "DAYS",
    category: "RESPONSE",
    legalBasis: "《中华人民共和国民事诉讼法（2023修正）》第一百二十八条",
    legalBasisUrl: `${CPL_URL}?text=128`,
    applicableProcedures: ["FIRST_INSTANCE", "REMAND_FIRST"],
    applicableCategories: ["CIVIL_COMMERCIAL"],
    remindDays: 7,
    sortOrder: 30
  },
  {
    code: "CIVIL_DEFENSE_SECOND",
    name: "二审答辩期",
    description: "对方当事人在收到上诉状副本之日起十五日内提出答辩状。",
    triggerLabel: "收到上诉状副本之日",
    periodValue: 15,
    periodUnit: "DAYS",
    category: "RESPONSE",
    legalBasis: "《中华人民共和国民事诉讼法（2023修正）》第一百七十四条",
    legalBasisUrl: `${CPL_URL}?text=174`,
    applicableProcedures: ["SECOND_INSTANCE", "REMAND_SECOND"],
    applicableCategories: ["CIVIL_COMMERCIAL"],
    remindDays: 7,
    sortOrder: 40
  },
  {
    code: "CIVIL_JURISDICTION_OBJECTION",
    name: "管辖权异议（应在答辩期内提出）",
    description: "对管辖权有异议的，应当在提交答辩状期间（收到起诉状副本之日起十五日内）提出。",
    triggerLabel: "收到起诉状副本之日",
    periodValue: 15,
    periodUnit: "DAYS",
    category: "RESPONSE",
    legalBasis: "《中华人民共和国民事诉讼法（2023修正）》第一百三十条",
    legalBasisUrl: `${CPL_URL}?text=130`,
    applicableProcedures: ["FIRST_INSTANCE", "REMAND_FIRST"],
    applicableCategories: ["CIVIL_COMMERCIAL"],
    remindDays: 7,
    sortOrder: 50
  },
  {
    code: "CIVIL_RETRIAL_APPLY",
    name: "申请再审期限",
    description:
      "当事人申请再审，应当在判决、裁定发生法律效力后六个月内提出（民诉法第211条第1/3/12/13项情形自知道或应当知道之日起算）。",
    triggerLabel: "判决/裁定发生法律效力之日",
    periodValue: 6,
    periodUnit: "MONTHS",
    category: "APPEAL",
    legalBasis: "《中华人民共和国民事诉讼法（2023修正）》第二百一十六条",
    legalBasisUrl: `${CPL_URL}?text=216`,
    applicableProcedures: ["FIRST_INSTANCE", "SECOND_INSTANCE", "REMAND_FIRST", "REMAND_SECOND"],
    applicableCategories: ["CIVIL_COMMERCIAL"],
    remindDays: 30,
    sortOrder: 60
  },
  {
    code: "CIVIL_ENFORCEMENT_APPLY",
    name: "申请强制执行期间",
    description:
      "申请执行的期间为二年，从法律文书规定履行期间的最后一日起计算；分期履行的从最后一期履行期限届满之日起算；未规定履行期间的从法律文书生效之日起算。",
    triggerLabel: "履行期间最后一日",
    periodValue: 2,
    periodUnit: "YEARS",
    category: "ENFORCEMENT",
    legalBasis: "《中华人民共和国民事诉讼法（2023修正）》第二百五十条",
    legalBasisUrl: `${CPL_URL}?text=250`,
    applicableProcedures: [
      "FIRST_INSTANCE",
      "SECOND_INSTANCE",
      "RETRIAL",
      "REMAND_FIRST",
      "REMAND_SECOND",
      "COMMERCIAL_ARBITRATION",
      "LABOR_ARBITRATION"
    ],
    applicableCategories: ["CIVIL_COMMERCIAL", "COMMERCIAL_ARBITRATION", "LABOR_ARBITRATION"],
    remindDays: 60,
    sortOrder: 70
  },
  {
    code: "PRE_LITIGATION_PRESERVATION_SUE",
    name: "诉前保全后起诉/申请仲裁期限",
    description: "申请人在人民法院采取保全措施后三十日内不依法提起诉讼或者申请仲裁的，人民法院应当解除保全。",
    triggerLabel: "保全措施采取之日",
    periodValue: 30,
    periodUnit: "DAYS",
    category: "PRESERVATION",
    legalBasis: "《中华人民共和国民事诉讼法（2023修正）》第一百〇四条",
    legalBasisUrl: `${CPL_URL}?text=104`,
    applicableProcedures: [],
    applicableCategories: ["CIVIL_COMMERCIAL", "COMMERCIAL_ARBITRATION", "LABOR_ARBITRATION"],
    remindDays: 10,
    sortOrder: 80
  },
  {
    code: "ARBITRATION_SET_ASIDE_APPLY",
    name: "申请撤销仲裁裁决期限",
    description:
      "当事人申请撤销裁决的，应当自收到裁决书之日起三个月内提出。注意：2025 修订仲裁法自 2026-03-01 施行，将期限由旧法六个月缩短为三个月；此前收到的裁决适用旧法与否需个案判断。",
    triggerLabel: "收到裁决书之日",
    periodValue: 3,
    periodUnit: "MONTHS",
    category: "ARBITRATION_SET_ASIDE",
    legalBasis: "《中华人民共和国仲裁法（2025修订）》第七十二条",
    legalBasisUrl:
      "https://ydzk.chineselaw.com/zxt/statuteDetail/detailPage/321d2994439dd60547f8d95b3cc8cf65?text=72",
    applicableProcedures: ["COMMERCIAL_ARBITRATION", "ARBITRATION_SET_ASIDE"],
    applicableCategories: ["CIVIL_COMMERCIAL", "COMMERCIAL_ARBITRATION"],
    remindDays: 15,
    sortOrder: 90
  },
  {
    code: "LABOR_ARBITRATION_SUE",
    name: "不服劳动仲裁裁决起诉期限",
    description:
      "对终局裁决以外的劳动争议仲裁裁决不服的，自收到仲裁裁决书之日起十五日内向人民法院提起诉讼；期满不起诉的裁决书发生法律效力。",
    triggerLabel: "收到仲裁裁决书之日",
    periodValue: 15,
    periodUnit: "DAYS",
    category: "APPEAL",
    legalBasis: "《中华人民共和国劳动争议调解仲裁法》第五十条",
    legalBasisUrl:
      "https://ydzk.chineselaw.com/zxt/statuteDetail/detailPage/20be108a89cc3a3231ec878f4cc6573f?text=50",
    applicableProcedures: ["LABOR_ARBITRATION"],
    applicableCategories: ["CIVIL_COMMERCIAL", "LABOR_ARBITRATION"],
    remindDays: 7,
    sortOrder: 100
  },
  {
    code: "ADMIN_APPEAL_JUDGMENT",
    name: "行政上诉期（不服一审判决）",
    description: "不服人民法院第一审判决的，在判决书送达之日起十五日内向上一级人民法院提起上诉。",
    triggerLabel: "判决书送达之日",
    periodValue: 15,
    periodUnit: "DAYS",
    category: "APPEAL",
    legalBasis: "《中华人民共和国行政诉讼法（2017修正）》第八十五条",
    legalBasisUrl:
      "https://ydzk.chineselaw.com/zxt/statuteDetail/detailPage/2f8d68f2222d839c0d9972edcda1ac53?text=85",
    applicableProcedures: ["FIRST_INSTANCE", "REMAND_FIRST"],
    applicableCategories: ["ADMINISTRATIVE"],
    remindDays: 7,
    sortOrder: 110
  },
  {
    code: "ADMIN_APPEAL_RULING",
    name: "行政上诉期（不服一审裁定）",
    description: "不服人民法院第一审裁定的，在裁定书送达之日起十日内向上一级人民法院提起上诉。",
    triggerLabel: "裁定书送达之日",
    periodValue: 10,
    periodUnit: "DAYS",
    category: "APPEAL",
    legalBasis: "《中华人民共和国行政诉讼法（2017修正）》第八十五条",
    legalBasisUrl:
      "https://ydzk.chineselaw.com/zxt/statuteDetail/detailPage/2f8d68f2222d839c0d9922edcda1ac53?text=85",
    applicableProcedures: ["FIRST_INSTANCE", "REMAND_FIRST"],
    applicableCategories: ["ADMINISTRATIVE"],
    remindDays: 5,
    sortOrder: 120
  },
  {
    code: "CIVIL_LIMITATION_GENERAL",
    name: "民事诉讼时效（普通三年）",
    description:
      "向人民法院请求保护民事权利的诉讼时效期间为三年，自权利人知道或者应当知道权利受到损害以及义务人之日起计算；法律另有规定的依照其规定。请结合个案核实起算事实与中止、中断情形。",
    triggerLabel: "知道或应当知道权利受损及义务人之日",
    periodValue: 3,
    periodUnit: "YEARS",
    category: "LIMITATION",
    legalBasis: "《中华人民共和国民法典》第一百八十八条",
    legalBasisUrl: CIVIL_CODE_URL,
    applicableProcedures: [],
    applicableCategories: ["CIVIL_COMMERCIAL", "COMMERCIAL_ARBITRATION"],
    remindDays: 60,
    sortOrder: 130
  },
  {
    code: "CIVIL_LIMITATION_MAX",
    name: "最长权利保护期（二十年）",
    description:
      "自权利受到损害之日起超过二十年的，人民法院不予保护；有特殊情况的，人民法院可以根据权利人的申请决定延长。与三年普通时效并行计算，登记时请同时核对两个起算日。",
    triggerLabel: "权利受到损害之日",
    periodValue: 20,
    periodUnit: "YEARS",
    category: "LIMITATION",
    legalBasis: "《中华人民共和国民法典》第一百八十八条第二款",
    legalBasisUrl: CIVIL_CODE_URL,
    applicableProcedures: [],
    applicableCategories: ["CIVIL_COMMERCIAL", "COMMERCIAL_ARBITRATION"],
    remindDays: 90,
    sortOrder: 140
  },
  {
    code: "EVIDENCE_DEADLINE_FIRST",
    name: "举证期限（一审普通程序·法定下限推算）",
    description:
      "举证期限由人民法院指定（可由当事人协商经法院准许），一审普通程序案件不得少于十五日。本规则按法定下限十五日推算默认值，请按法院举证通知书载明的期限调整到期日。",
    triggerLabel: "收到法院举证通知书之日（以通知书指定为准）",
    periodValue: 15,
    periodUnit: "DAYS",
    category: "EVIDENCE",
    legalBasis: "《民诉法解释》第九十九条（一审普通程序举证期限不得少于十五日）",
    legalBasisUrl: EVIDENCE_RULES_URL,
    applicableProcedures: ["FIRST_INSTANCE", "REMAND_FIRST"],
    applicableCategories: ["CIVIL_COMMERCIAL"],
    remindDays: 3,
    sortOrder: 150
  },
  {
    code: "EVIDENCE_DEADLINE_SECOND",
    name: "举证期限（二审新证据·法定下限推算）",
    description:
      "当事人提供新的证据的第二审案件，举证期限不得少于十日。本规则按法定下限十日推算默认值，请按法院举证通知书载明的期限调整到期日。",
    triggerLabel: "收到法院举证通知书之日（以通知书指定为准）",
    periodValue: 10,
    periodUnit: "DAYS",
    category: "EVIDENCE",
    legalBasis: "《民诉法解释》第九十九条（二审新证据举证期限不得少于十日）",
    legalBasisUrl: EVIDENCE_RULES_URL,
    applicableProcedures: ["SECOND_INSTANCE", "REMAND_SECOND"],
    applicableCategories: ["CIVIL_COMMERCIAL"],
    remindDays: 3,
    sortOrder: 160
  }
];

export async function seedV49DeadlineRules(prisma: PrismaClient) {
  for (const rule of deadlineRuleSeeds) {
    const data = {
      name: rule.name,
      description: rule.description ?? null,
      triggerLabel: rule.triggerLabel,
      periodValue: rule.periodValue,
      periodUnit: rule.periodUnit,
      category: rule.category,
      legalBasis: rule.legalBasis,
      legalBasisUrl: rule.legalBasisUrl,
      // 2026-09-21 增补的 P2-4 四条用当日核验日期
      verifiedAt: P24_CODES.has(rule.code) ? VERIFIED_AT_P24 : VERIFIED_AT,
      applicableProcedures: rule.applicableProcedures,
      applicableCategories: rule.applicableCategories,
      remindDays: rule.remindDays,
      isBuiltIn: true,
      sortOrder: rule.sortOrder
    };
    await prisma.deadlineRule.upsert({
      where: { code: rule.code },
      create: { code: rule.code, ...data },
      // 内置规则升级时覆盖内容，但保留律所自己改过的 enabled 开关
      update: data
    });
  }
  console.log(`✓ v0.49 法定期限规则 ${deadlineRuleSeeds.length} 条（核验日期 ${VERIFIED_AT.toISOString().slice(0, 10)}）`);
}
