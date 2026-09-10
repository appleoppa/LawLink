/**
 * v1.0 P3：内置模板扩容（第二批 12 个，PRD §11.3 / §二十三）。
 *
 * 与 v0.8 首批同一套 docx 生成方式与 {{var}} 占位符体系；
 * 变量名以 src/lib/template-engine.ts 的渲染上下文为准
 * （firm / matter / client / opposing / proceeding / lawyer / todayCN）。
 * 律所部署后可在 /settings/templates 上传自定义版本替换。
 */
import { AlignmentType } from "docx";
import {
  title,
  body,
  blank,
  kvTable,
  pack,
  type BuiltInTemplate
} from "./template-builder";

// ============================================================
// T11 授权委托书（单位）
// ============================================================
const T11_VARS = [
  "client.name",
  "client.idNumber",
  "client.address",
  "firm.name",
  "lawyer.name",
  "opposing.name",
  "matter.causeText",
  "todayCN"
];

async function buildT11(): Promise<Buffer> {
  return pack([
    title("授权委托书"),
    blank(),
    body("委托人：{{client.name}}"),
    body("统一社会信用代码：{{client.idNumber}}"),
    body("住所地：{{client.address}}"),
    body("法定代表人 / 负责人：________________"),
    blank(),
    body("受委托人：{{lawyer.name}}，{{firm.name}}律师。"),
    blank(),
    body("现委托上列受委托人在本单位与 {{opposing.name}} {{matter.causeText}} 一案中，作为本单位的诉讼（仲裁）代理人。", { indent: true }),
    blank(),
    body("代理权限为(请勾选)：", { bold: true }),
    body("☐ 一般代理。"),
    body("☐ 特别代理。包括：代为承认、放弃、变更诉讼请求；代为提起反诉、上诉；代为申请执行；代为和解、调解；代为签收法律文书。"),
    blank(),
    body("委托期限：自签署之日起至本案代理事项终结。"),
    blank(),
    blank(),
    body("委托人(盖章)：________________"),
    body("法定代表人(签字)：________________"),
    blank(),
    body("受委托人(签字)：{{lawyer.name}}"),
    blank(),
    body("{{todayCN}}", { align: AlignmentType.RIGHT })
  ]);
}

// ============================================================
// T12 民事上诉状
// ============================================================
const T12_VARS = [
  "client.name",
  "client.idNumber",
  "client.address",
  "opposing.name",
  "opposing.address",
  "matter.causeText",
  "proceeding.caseNo",
  "proceeding.court",
  "lawyer.name",
  "todayCN"
];

async function buildT12(): Promise<Buffer> {
  return pack([
    title("民事上诉状"),
    blank(),
    body("上诉人（原审________）：{{client.name}}"),
    body("身份证号 / 统一社会信用代码：{{client.idNumber}}"),
    body("住址：{{client.address}}"),
    blank(),
    body("被上诉人（原审________）：{{opposing.name}}"),
    body("住址：{{opposing.address}}"),
    blank(),
    body("上诉人因与被上诉人 {{matter.causeText}} 一案，不服 {{proceeding.court}} 作出的（________）号民事判决/裁定，现提起上诉。", { indent: true }),
    body("原审案号：{{proceeding.caseNo}}", { bold: true }),
    blank(),
    body("上诉请求：", { bold: true }),
    body("1. 依法撤销原审判决第____项，改判________________；", { indent: true }),
    body("2. 本案一、二审诉讼费用由被上诉人承担。", { indent: true }),
    blank(),
    body("上诉理由：", { bold: true }),
    body("一、原审判决认定事实错误。________________________________________", { indent: true }),
    body("二、原审判决适用法律错误。________________________________________", { indent: true }),
    body("三、________________________________________________________________", { indent: true }),
    blank(),
    body("综上，请求二审法院依法支持上诉人的上诉请求。", { indent: true }),
    blank(),
    body("此致"),
    body("________人民法院", { bold: true }),
    blank(),
    blank(),
    body("上诉人(签字/盖章)：________________"),
    body("                                                            代理律师：{{lawyer.name}}"),
    blank(),
    body("{{todayCN}}", { align: AlignmentType.RIGHT })
  ]);
}

// ============================================================
// T13 仲裁申请书
// ============================================================
const T13_VARS = [
  "client.name",
  "client.idNumber",
  "client.address",
  "client.phone",
  "opposing.name",
  "opposing.idNumber",
  "opposing.address",
  "matter.causeText",
  "matter.claimAmount",
  "proceeding.court",
  "lawyer.name",
  "todayCN"
];

async function buildT13(): Promise<Buffer> {
  return pack([
    title("仲裁申请书"),
    blank(),
    body("申请人：{{client.name}}"),
    body("身份证号 / 统一社会信用代码：{{client.idNumber}}"),
    body("住址：{{client.address}}"),
    body("联系电话：{{client.phone}}"),
    blank(),
    body("被申请人：{{opposing.name}}"),
    body("身份证号 / 统一社会信用代码：{{opposing.idNumber}}"),
    body("住址：{{opposing.address}}"),
    blank(),
    body("案由：{{matter.causeText}}", { bold: true }),
    body("争议金额：{{matter.claimAmount}}", { bold: true }),
    body("仲裁依据：双方于____年__月__日签订的《________________》第____条仲裁条款。", { indent: true }),
    blank(),
    body("仲裁请求：", { bold: true }),
    body("1. ________________；", { indent: true }),
    body("2. ________________；", { indent: true }),
    body("3. 本案仲裁费用由被申请人承担。", { indent: true }),
    blank(),
    body("事实与理由：", { bold: true }),
    body("________________________________________________________________________", { indent: true }),
    body("________________________________________________________________________", { indent: true }),
    blank(),
    body("此致"),
    body("{{proceeding.court}}", { bold: true }),
    blank(),
    blank(),
    body("申请人(签字/盖章)：________________"),
    body("                                                            代理律师：{{lawyer.name}}"),
    blank(),
    body("{{todayCN}}", { align: AlignmentType.RIGHT })
  ]);
}

// ============================================================
// T14 财产保全申请书
// ============================================================
const T14_VARS = [
  "client.name",
  "client.address",
  "opposing.name",
  "opposing.address",
  "matter.causeText",
  "matter.claimAmount",
  "proceeding.court",
  "proceeding.caseNo",
  "lawyer.name",
  "todayCN"
];

async function buildT14(): Promise<Buffer> {
  return pack([
    title("财产保全申请书"),
    blank(),
    body("申请人：{{client.name}}"),
    body("住址：{{client.address}}"),
    blank(),
    body("被申请人：{{opposing.name}}"),
    body("住址：{{opposing.address}}"),
    blank(),
    body("案由：{{matter.causeText}}    案号：{{proceeding.caseNo}}", { bold: true }),
    blank(),
    body("请求事项：", { bold: true }),
    body("1. 依法查封、冻结、扣押被申请人名下价值 {{matter.claimAmount}} 的财产；", { indent: true }),
    body("2. 具体财产线索：详见附件《财产线索清单》。", { indent: true }),
    blank(),
    body("事实与理由：", { bold: true }),
    body("申请人与被申请人 {{matter.causeText}} 一案，因被申请人存在转移、隐匿财产的可能，不采取保全措施将导致生效裁判难以执行。根据《中华人民共和国民事诉讼法》第一百〇三条、第一百〇四条之规定，特申请财产保全。", { indent: true }),
    blank(),
    body("担保方式：☐ 现金担保  ☐ 保险公司保函  ☐ 财产担保（详见担保材料）", { indent: true }),
    blank(),
    body("此致"),
    body("{{proceeding.court}}", { bold: true }),
    blank(),
    blank(),
    body("申请人(签字/盖章)：________________"),
    body("                                                            代理律师：{{lawyer.name}}"),
    blank(),
    body("{{todayCN}}", { align: AlignmentType.RIGHT })
  ]);
}

// ============================================================
// T15 律师函
// ============================================================
const T15_VARS = [
  "firm.name",
  "firm.address",
  "firm.phone",
  "client.name",
  "opposing.name",
  "matter.causeText",
  "lawyer.name",
  "todayCN"
];

async function buildT15(): Promise<Buffer> {
  return pack([
    body("{{firm.name}}", { align: AlignmentType.CENTER, bold: true }),
    body("地址：{{firm.address}}    电话：{{firm.phone}}", { align: AlignmentType.CENTER }),
    blank(),
    title("律 师 函"),
    body("（____）____律函字第____号", { align: AlignmentType.RIGHT }),
    blank(),
    body("{{opposing.name}}："),
    blank(),
    body("{{firm.name}}接受 {{client.name}} 的委托，指派本律师就 {{matter.causeText}} 相关事宜致函贵方。", { indent: true }),
    blank(),
    body("一、基本事实", { bold: true }),
    body("________________________________________________________________________", { indent: true }),
    blank(),
    body("二、律师意见", { bold: true }),
    body("________________________________________________________________________", { indent: true }),
    blank(),
    body("三、要求与期限", { bold: true }),
    body("请贵方于收到本函之日起____日内________________；逾期，本律师将建议委托人依法采取诉讼、仲裁、保全等法律措施，由此产生的一切法律后果由贵方承担。", { indent: true }),
    blank(),
    body("特此函告。", { indent: true }),
    blank(),
    blank(),
    body("{{firm.name}}", { align: AlignmentType.RIGHT }),
    body("律师：{{lawyer.name}}", { align: AlignmentType.RIGHT }),
    body("{{todayCN}}", { align: AlignmentType.RIGHT })
  ]);
}

// ============================================================
// T16 法律意见书
// ============================================================
const T16_VARS = [
  "firm.name",
  "client.name",
  "matter.title",
  "matter.causeText",
  "lawyer.name",
  "todayCN"
];

async function buildT16(): Promise<Buffer> {
  return pack([
    body("{{firm.name}}", { align: AlignmentType.CENTER, bold: true }),
    title("法律意见书"),
    body("（____）____法意字第____号", { align: AlignmentType.RIGHT }),
    blank(),
    body("致：{{client.name}}"),
    blank(),
    body("{{firm.name}}接受贵方委托，指派本律师就「{{matter.title}}」相关法律事项出具本法律意见书。", { indent: true }),
    blank(),
    body("一、委托事项与审查范围", { bold: true }),
    body("________________________________________________________________________", { indent: true }),
    blank(),
    body("二、基本事实", { bold: true }),
    body("________________________________________________________________________", { indent: true }),
    blank(),
    body("三、法律分析", { bold: true }),
    body("________________________________________________________________________", { indent: true }),
    body("________________________________________________________________________", { indent: true }),
    blank(),
    body("四、结论意见与风险提示", { bold: true }),
    body("________________________________________________________________________", { indent: true }),
    blank(),
    body("本意见书仅基于截至出具之日委托人提供的材料作出，仅供委托人就本次委托事项使用。", { indent: true }),
    blank(),
    blank(),
    body("{{firm.name}}", { align: AlignmentType.RIGHT }),
    body("经办律师：{{lawyer.name}}", { align: AlignmentType.RIGHT }),
    body("{{todayCN}}", { align: AlignmentType.RIGHT })
  ]);
}

// ============================================================
// T17 代理词
// ============================================================
const T17_VARS = [
  "client.name",
  "matter.causeText",
  "proceeding.caseNo",
  "proceeding.court",
  "firm.name",
  "lawyer.name",
  "todayCN"
];

async function buildT17(): Promise<Buffer> {
  return pack([
    title("代 理 词"),
    blank(),
    body("审判长、审判员："),
    blank(),
    body("{{firm.name}}接受 {{client.name}} 的委托，指派本律师担任其与对方当事人 {{matter.causeText}} 一案（案号：{{proceeding.caseNo}}）的诉讼代理人。经庭前阅卷、调查取证并参加法庭审理，现发表如下代理意见：", { indent: true }),
    blank(),
    body("一、关于本案事实", { bold: true }),
    body("________________________________________________________________________", { indent: true }),
    blank(),
    body("二、关于证据与质证意见", { bold: true }),
    body("________________________________________________________________________", { indent: true }),
    blank(),
    body("三、关于法律适用", { bold: true }),
    body("________________________________________________________________________", { indent: true }),
    blank(),
    body("综上所述，请合议庭采纳代理人的意见，依法支持委托人的主张。", { indent: true }),
    blank(),
    body("此致"),
    body("{{proceeding.court}}", { bold: true }),
    blank(),
    blank(),
    body("代理律师：{{lawyer.name}}", { align: AlignmentType.RIGHT }),
    body("{{todayCN}}", { align: AlignmentType.RIGHT })
  ]);
}

// ============================================================
// T18 谈话笔录
// ============================================================
const T18_VARS = ["firm.name", "matter.code", "matter.title", "lawyer.name", "todayCN"];

async function buildT18(): Promise<Buffer> {
  return pack([
    body("{{firm.name}}", { align: AlignmentType.CENTER, bold: true }),
    title("谈 话 笔 录"),
    blank(),
    kvTable([
      ["案件", "{{matter.title}}（{{matter.code}}）"],
      ["时间", "____年__月__日 __时__分 至 __时__分"],
      ["地点", ""],
      ["谈话人", "{{lawyer.name}}"],
      ["记录人", ""],
      ["被谈话人", ""],
      ["身份/联系方式", ""]
    ]),
    blank(),
    body("谈话内容：", { bold: true }),
    body("问：________________________________________________________________"),
    body("答：________________________________________________________________"),
    blank(),
    body("问：________________________________________________________________"),
    body("答：________________________________________________________________"),
    blank(),
    body("问：________________________________________________________________"),
    body("答：________________________________________________________________"),
    blank(),
    blank(),
    body("以上笔录经被谈话人核对无误。"),
    blank(),
    body("被谈话人(签字按印)：________________    谈话人(签字)：________________"),
    blank(),
    body("{{todayCN}}", { align: AlignmentType.RIGHT })
  ]);
}

// ============================================================
// T19 会见笔录（刑事）
// ============================================================
const T19_VARS = ["firm.name", "matter.code", "matter.title", "client.name", "lawyer.name", "todayCN"];

async function buildT19(): Promise<Buffer> {
  return pack([
    body("{{firm.name}}", { align: AlignmentType.CENTER, bold: true }),
    title("会 见 笔 录"),
    blank(),
    kvTable([
      ["案件", "{{matter.title}}（{{matter.code}}）"],
      ["会见时间", "____年__月__日 __时__分 至 __时__分"],
      ["会见地点", "________看守所 / 监狱"],
      ["会见律师", "{{lawyer.name}}"],
      ["被会见人", "{{client.name}}"],
      ["涉嫌罪名 / 诉讼阶段", ""],
      ["羁押期限情况", ""]
    ]),
    blank(),
    body("会见内容：", { bold: true }),
    body("一、告知事项（律师身份、委托手续、权利义务）：", { bold: true }),
    body("________________________________________________________________________"),
    blank(),
    body("二、案件事实了解：", { bold: true }),
    body("________________________________________________________________________"),
    body("________________________________________________________________________"),
    blank(),
    body("三、程序性事项（强制措施、讯问情况、身体状况、家属转达）：", { bold: true }),
    body("________________________________________________________________________"),
    blank(),
    body("四、下一步辩护安排：", { bold: true }),
    body("________________________________________________________________________"),
    blank(),
    body("以上笔录经被会见人核对无误。"),
    blank(),
    body("被会见人(签字按印)：________________    会见律师(签字)：{{lawyer.name}}"),
    blank(),
    body("{{todayCN}}", { align: AlignmentType.RIGHT })
  ]);
}

// ============================================================
// T20 结案登记表
// ============================================================
const T20_VARS = [
  "firm.name",
  "matter.code",
  "matter.title",
  "matter.category",
  "matter.causeText",
  "matter.claimAmount",
  "client.name",
  "opposing.name",
  "proceeding.court",
  "proceeding.caseNo",
  "lawyer.name",
  "todayCN"
];

async function buildT20(): Promise<Buffer> {
  return pack([
    body("{{firm.name}}", { align: AlignmentType.CENTER, bold: true }),
    title("结案登记表"),
    blank(),
    kvTable([
      ["案件编号", "{{matter.code}}"],
      ["案件名称", "{{matter.title}}"],
      ["案件类别", "{{matter.category}}"],
      ["案由", "{{matter.causeText}}"],
      ["委托人", "{{client.name}}"],
      ["对方当事人", "{{opposing.name}}"],
      ["办理机关", "{{proceeding.court}}"],
      ["案号", "{{proceeding.caseNo}}"],
      ["标的金额", "{{matter.claimAmount}}"],
      ["承办律师", "{{lawyer.name}}"],
      ["结案日期", "{{todayCN}}"]
    ]),
    blank(),
    body("结案方式：☐ 判决  ☐ 调解  ☐ 仲裁裁决  ☐ 和解撤诉  ☐ 执行完毕  ☐ 其他________", { bold: true }),
    blank(),
    body("办理结果摘要：", { bold: true }),
    body("________________________________________________________________________"),
    body("________________________________________________________________________"),
    blank(),
    body("律师费收取情况：☐ 已结清  ☐ 未结清（余额________元）"),
    body("原件材料退还情况：☐ 已退还并签收  ☐ 无需退还"),
    blank(),
    body("承办律师(签字)：________________    主任审核(签字)：________________"),
    blank(),
    body("{{todayCN}}", { align: AlignmentType.RIGHT })
  ]);
}

// ============================================================
// T21 证据目录
// ============================================================
const T21_VARS = [
  "client.name",
  "matter.causeText",
  "proceeding.court",
  "proceeding.caseNo",
  "lawyer.name",
  "todayCN"
];

async function buildT21(): Promise<Buffer> {
  return pack([
    title("证 据 目 录"),
    blank(),
    body("提交人：{{client.name}}    案由：{{matter.causeText}}"),
    body("受理机关：{{proceeding.court}}    案号：{{proceeding.caseNo}}"),
    blank(),
    kvTable([
      ["序号 / 证据名称", "证明目的 / 来源 / 页数"],
      ["证据一：", ""],
      ["证据二：", ""],
      ["证据三：", ""],
      ["证据四：", ""],
      ["证据五：", ""],
      ["证据六：", ""]
    ]),
    blank(),
    body("以上证据均提交复印件，原件当庭核对。", { indent: true }),
    blank(),
    body("提交人(签字/盖章)：________________    代理律师：{{lawyer.name}}"),
    blank(),
    body("{{todayCN}}", { align: AlignmentType.RIGHT })
  ]);
}

// ============================================================
// T22 空白文档（律所抬头）
// ============================================================
const T22_VARS = ["firm.name", "firm.address", "firm.phone", "lawyer.name", "todayCN"];

async function buildT22(): Promise<Buffer> {
  return pack([
    body("{{firm.name}}", { align: AlignmentType.CENTER, bold: true }),
    body("地址：{{firm.address}}    电话：{{firm.phone}}", { align: AlignmentType.CENTER }),
    blank(),
    blank(),
    body(""),
    body(""),
    body(""),
    body(""),
    body(""),
    body(""),
    body(""),
    body(""),
    blank(),
    blank(),
    body("经办律师：{{lawyer.name}}", { align: AlignmentType.RIGHT }),
    body("{{todayCN}}", { align: AlignmentType.RIGHT })
  ]);
}

// ============================================================
// 注册表（第二批）
// ============================================================
export const V1_TEMPLATES: BuiltInTemplate[] = [
  {
    key: "power_of_attorney_organization",
    name: "授权委托书(单位)",
    category: "RETAINER",
    description: "法人或非法人组织授权委托书，含一般代理 / 特别代理勾选。",
    applicableCategories: [],
    variables: T11_VARS,
    buildBuffer: buildT11
  },
  {
    key: "civil_appeal",
    name: "民事上诉状",
    category: "LITIGATION",
    description: "不服一审判决/裁定的上诉状标准格式。上诉请求与理由需律师填充。",
    applicableCategories: ["CIVIL_COMMERCIAL"],
    variables: T12_VARS,
    buildBuffer: buildT12
  },
  {
    key: "arbitration_application",
    name: "仲裁申请书",
    category: "LITIGATION",
    description: "商事/劳动仲裁申请书标准格式，含仲裁条款援引。",
    applicableCategories: ["CIVIL_COMMERCIAL", "COMMERCIAL_ARBITRATION", "LABOR_ARBITRATION"],
    variables: T13_VARS,
    buildBuffer: buildT13
  },
  {
    key: "property_preservation_application",
    name: "财产保全申请书",
    category: "LITIGATION",
    description: "诉前/诉中财产保全申请，含担保方式勾选（依据民诉法 103/104 条）。",
    applicableCategories: ["CIVIL_COMMERCIAL", "COMMERCIAL_ARBITRATION"],
    variables: T14_VARS,
    buildBuffer: buildT14
  },
  {
    key: "lawyer_letter",
    name: "律师函",
    category: "WORK_PRODUCT",
    description: "对外催告/告知函，套律所抬头，含要求与期限段落。",
    applicableCategories: [],
    variables: T15_VARS,
    buildBuffer: buildT15
  },
  {
    key: "legal_opinion",
    name: "法律意见书",
    category: "WORK_PRODUCT",
    description: "四段式法律意见书（委托事项/事实/分析/结论与风险提示）。",
    applicableCategories: [],
    variables: T16_VARS,
    buildBuffer: buildT16
  },
  {
    key: "agency_opinion",
    name: "代理词",
    category: "WORK_PRODUCT",
    description: "庭审代理词标准结构（事实/证据/法律适用三段）。",
    applicableCategories: ["CIVIL_COMMERCIAL", "COMMERCIAL_ARBITRATION", "LABOR_ARBITRATION", "ADMINISTRATIVE"],
    variables: T17_VARS,
    buildBuffer: buildT17
  },
  {
    key: "meeting_notes",
    name: "谈话笔录",
    category: "HEARING",
    description: "与当事人/证人谈话的问答式笔录，含签字确认。",
    applicableCategories: [],
    variables: T18_VARS,
    buildBuffer: buildT18
  },
  {
    key: "detention_meeting_notes",
    name: "会见笔录(刑事)",
    category: "HEARING",
    description: "看守所会见笔录：告知事项/案件事实/程序事项/辩护安排四段。",
    applicableCategories: ["CRIMINAL"],
    variables: T19_VARS,
    buildBuffer: buildT19
  },
  {
    key: "case_closing_registration",
    name: "结案登记表",
    category: "CLOSING",
    description: "结案信息登记：结案方式/结果摘要/费用与原件退还确认。",
    applicableCategories: [],
    variables: T20_VARS,
    buildBuffer: buildT20
  },
  {
    key: "evidence_catalog",
    name: "证据目录",
    category: "ARCHIVE",
    description: "随证据材料提交法院/仲裁机构的证据清单（名称/证明目的/页数）。",
    applicableCategories: ["CIVIL_COMMERCIAL", "COMMERCIAL_ARBITRATION", "LABOR_ARBITRATION", "ADMINISTRATIVE"],
    variables: T21_VARS,
    buildBuffer: buildT21
  },
  {
    key: "blank_letterhead",
    name: "空白文档(律所抬头)",
    category: "BLANK",
    description: "套律所抬头的空白文档，自由撰写任何文书。",
    applicableCategories: [],
    variables: T22_VARS,
    buildBuffer: buildT22
  }
];
