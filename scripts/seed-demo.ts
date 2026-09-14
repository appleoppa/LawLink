/**
 * LawLink 演示数据：清空业务数据后，重新生成一套覆盖各功能板块的虚构案例。
 *
 * 运行（仅限本机开发库）：
 *   npx tsx --env-file=.env scripts/seed-demo.ts --confirm
 *
 * 清空范围：客户、收案、案件及其全部下挂数据（程序/环节/期限/开庭/任务/材料/记录/财务/
 * 用章/开票/归档/保全/快递/短信/通知）、律所资料、公告、外部联系人、冲突检索、自定义字段、
 * 发号计数器，以及这些材料在 storage 中的文件。
 * 保留：账号、岗位角色、团队（成员重建）、案由库、期限规则、阶段模板、文书模板及其源文件、
 * 用章配置、系统设置（AI/元典/律所信息）、外部调用台账；审计日志仅删除指向已删除业务记录的孤儿条目。
 *
 * 演示账号密码与当前系统超级管理员一致（复制其密码哈希，脚本与仓库中不出现任何明文密码）。
 * 全部主体、证件号、案号均为虚构，仅用于界面走查。
 */
import PizZip from "pizzip";
import type {
  ClientType,
  DocumentCategory,
  DocumentSourceOrigin,
  LitigationStanding,
  MatterCategory,
  PartyRole,
  PartyType,
  Prisma,
  ProcedureType,
  UserRole
} from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { storage } from "../src/lib/storage";
import { encryptBuffer, sha256 } from "../src/lib/storage/crypto";
import { sealIdNumber } from "../src/lib/clients/id-number-crypto";
import { seedDefaultFolders } from "../src/lib/default-folders";
import { procedureStagePresetsForProcedure } from "../src/lib/procedure-stage-defaults";
import { generateFirmCaseNo, generateInternalCode } from "../src/server/matters/code-generator";
import { generateClientCode } from "../src/server/clients/code-generator";
import { nextSystemCounter } from "../src/lib/system-counter";
import { runConflictCheck, type QueryItem } from "../src/server/conflicts/algorithm";
import { parseSms } from "../src/lib/sms-parser";
import { checklistForCategory } from "../src/lib/archive/checklists";
import { ARCHIVE_MANUAL_CHECKS, ARCHIVE_SNAPSHOT_VERSION } from "../src/lib/archive/snapshot";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DAY = 86_400_000;
const NOW = new Date();

/* ───────────────────────── 通用工具 ───────────────────────── */

/** 上海时区的「今天」年月日（开发机可能不在东八区，所有演示时间按上海时间生成） */
const SH_TODAY = (() => {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(NOW).split("-").map(Number);
  return { y, m, d };
})();

/** 上海时间的具体日期时刻 */
function sh(y: number, m: number, d: number, hour = 9, minute = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hour - 8, minute));
}

/** 相对今天（上海）的日期；hour/minute 为上海本地时间 */
function day(offset: number, hour = 9, minute = 0): Date {
  return sh(SH_TODAY.y, SH_TODAY.m, SH_TODAY.d + offset, hour, minute);
}

function monthsAgo(n: number, dayOfMonth = 10): Date {
  return sh(SH_TODAY.y, SH_TODAY.m - n, dayOfMonth, 10);
}

const USCC_CHARS = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
/** 生成校验位正确的虚构统一社会信用代码 */
function uscc(body17: string): string {
  const sum = body17.split("").reduce((s, ch, i) => s + USCC_CHARS.indexOf(ch) * USCC_WEIGHTS[i], 0);
  const c = 31 - (sum % 31);
  return body17 + USCC_CHARS[c === 31 ? 0 : c];
}

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
/** 生成校验位正确的虚构身份证号 */
function idCard(body17: string): string {
  const sum = body17.split("").reduce((s, ch, i) => s + Number(ch) * ID_WEIGHTS[i], 0);
  return body17 + "10X98765432"[sum % 11];
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 生成可在线预览的最小 docx（标题 + 段落；页之间插分页符） */
function makeDocx(title: string, pages: string[][]): Buffer {
  const para = (text: string, bold = false) =>
    `<w:p><w:r>${bold ? "<w:rPr><w:b/><w:sz w:val=\"32\"/></w:rPr>" : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  const pageBreak = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  const body = [para(title, true), ...pages.map((lines, i) => (i > 0 ? pageBreak : "") + lines.map((l) => para(l)).join(""))].join("");
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

/* ───────────────────────── 清空业务数据 ───────────────────────── */

async function wipe() {
  const docs = await prisma.document.findMany({ where: { templateBlobOf: null }, select: { id: true, path: true } });
  const firmFiles = await prisma.firmFile.findMany({ select: { path: true } });
  const archives = await prisma.archiveRecord.findMany({ select: { exportPath: true } });

  await prisma.$transaction(async (tx) => {
    await tx.notification.deleteMany({});
    await tx.reviewRecord.deleteMany({});
    await tx.sealRequest.updateMany({ data: { parentSealRequestId: null } });
    await tx.sealRequest.deleteMany({});
    await tx.invoiceRequest.deleteMany({});
    await tx.archiveRecord.deleteMany({});
    await tx.smsMessage.deleteMany({});
    await tx.expressTracking.deleteMany({});
    await tx.preservationCase.deleteMany({});
    await tx.allocation.deleteMany({});
    await tx.payment.deleteMany({});
    await tx.receivable.deleteMany({});
    await tx.financeCorrection.deleteMany({});
    await tx.feeEntry.updateMany({ data: { parentFeeEntryId: null } });
    await tx.feeEntry.deleteMany({});
    await tx.commissionPlan.deleteMany({});
    await tx.billing.deleteMany({});
    await tx.engagementMatter.deleteMany({});
    await tx.engagement.deleteMany({});
    await tx.evidenceItem.deleteMany({});
    await tx.timelineEvent.deleteMany({});
    await tx.note.deleteMany({});
    await tx.task.deleteMany({});
    await tx.conflictHit.deleteMany({});
    await tx.conflictCheck.deleteMany({});
    await tx.document.deleteMany({ where: { templateBlobOf: null } });
    await tx.documentFolder.deleteMany({});
    await tx.matterLink.deleteMany({});
    await tx.relatedEntity.deleteMany({});
    await tx.matterProcedure.deleteMany({});
    await tx.party.deleteMany({});
    await tx.matterClient.deleteMany({});
    await tx.matterMember.deleteMany({});
    await tx.matter.deleteMany({});
    await tx.intake.deleteMany({});
    await tx.contact.deleteMany({});
    await tx.client.deleteMany({});
    await tx.firmFile.updateMany({ data: { supersededById: null } });
    await tx.firmFile.deleteMany({});
    await tx.announcement.deleteMany({});
    await tx.externalContact.deleteMany({});
    await tx.customFieldDef.deleteMany({});
    await tx.systemSetting.deleteMany({
      where: {
        OR: [
          { key: { startsWith: "code-counter-" } },
          { key: { startsWith: "firm-caseno-" } },
          { key: { startsWith: "client-code-counter-" } },
          { key: { startsWith: "seal-counter-" } },
          { key: "archivePolicy" },
          { key: "reminder-webhook-last-result" }
        ]
      }
    });
    // 「功能验收」测试审批组（其描述注明测试结束可停用）→ 由演示审批组替代
    const testGroups = await tx.approvalPermissionGroup.findMany({ where: { name: { startsWith: "功能验收" } }, select: { id: true } });
    const demoGroups = await tx.approvalPermissionGroup.findMany({ where: { name: { startsWith: "演示·" } }, select: { id: true } });
    const groupIds = [...testGroups, ...demoGroups].map((g) => g.id);
    await tx.approvalPermissionRule.deleteMany({ where: { groupId: { in: groupIds } } });
    await tx.approvalPermissionMember.deleteMany({ where: { groupId: { in: groupIds } } });
    await tx.approvalPermissionGroup.deleteMany({ where: { id: { in: groupIds } } });
    await tx.teamMember.deleteMany({});
    await tx.team.deleteMany({});
  });

  let removed = 0;
  for (const p of [...docs.map((d) => d.path), ...firmFiles.map((f) => f.path), ...archives.map((a) => a.exportPath)]) {
    if (!p) continue;
    await storage.deleteFile(p).catch(() => undefined);
    removed++;
  }
  console.log(`✓ 已清空业务数据（材料 ${docs.length} 份、律所资料 ${firmFiles.length} 份，storage 文件 ${removed} 个）`);
}

/* ───────────────────────── 账号 / 团队 / 审批授权 ───────────────────────── */

type Users = Record<"ye" | "zhou" | "shen" | "lin" | "chen" | "he" | "wang", { id: string; name: string }>;

async function seedUsers(): Promise<Users> {
  const admin = await prisma.user.findFirst({ where: { systemRole: "SUPER_ADMIN", active: true }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("未找到可用的系统超级管理员账号，请先运行 prisma db seed");
  const adminRole = await prisma.roleDefinition.findFirst({ where: { name: "行政" }, select: { id: true } });

  const specs: { key: keyof Users; name: string; email: string; role: UserRole; roleDefinitionId?: string | null; phone: string }[] = [
    { key: "zhou", name: "周岚", email: "zhoulan@lawlink.local", role: "PRINCIPAL_LAWYER", phone: "13901860001" },
    { key: "shen", name: "沈青", email: "shenqing@lawlink.local", role: "LAWYER", phone: "13901860002" },
    { key: "lin", name: "林默", email: "linmo@lawlink.local", role: "LAWYER", phone: "13901860003" },
    { key: "chen", name: "陈晓", email: "chenxiao@lawlink.local", role: "ASSISTANT", phone: "13901860004" },
    { key: "he", name: "何静", email: "hejing@lawlink.local", role: "FINANCE", phone: "13901860005" },
    { key: "wang", name: "王璐", email: "wanglu@lawlink.local", role: adminRole ? "CUSTOM" : "ASSISTANT", roleDefinitionId: adminRole?.id ?? null, phone: "13901860006" }
  ];
  const users = { ye: { id: admin.id, name: admin.name } } as Users;
  for (const s of specs) {
    const u = await prisma.user.upsert({
      where: { email: s.email },
      update: { name: s.name, role: s.role, roleDefinitionId: s.roleDefinitionId ?? null, active: true, phone: s.phone, passwordHash: admin.passwordHash, lastLoginAt: day(-Math.ceil(Math.random() * 5)) },
      create: { email: s.email, name: s.name, role: s.role, roleDefinitionId: s.roleDefinitionId ?? null, phone: s.phone, passwordHash: admin.passwordHash, lastLoginAt: day(-2) }
    });
    users[s.key] = { id: u.id, name: u.name };
  }

  await prisma.team.create({
    data: {
      name: `${admin.name}团队`,
      leaderId: users.ye.id,
      members: {
        create: [
          { userId: users.ye.id, canViewAllMatters: true },
          { userId: users.shen.id },
          { userId: users.chen.id }
        ]
      }
    }
  });
  await prisma.team.create({
    data: {
      name: "周岚团队",
      leaderId: users.zhou.id,
      members: { create: [{ userId: users.zhou.id, canViewAllMatters: true }, { userId: users.lin.id }] }
    }
  });

  const sealTypes = ["OFFICIAL_SEAL", "CONTRACT_SEAL", "FINANCE_SEAL", "LEGAL_REP_SEAL", "CONTRACT_REVIEW_SEAL"] as const;
  const groups: { name: string; description: string; members: string[]; rules: Prisma.ApprovalPermissionRuleCreateWithoutGroupInput[] }[] = [
    {
      name: "演示·收案审批",
      description: "全部案件类别的收案审批与转案。",
      members: [users.ye.id, users.zhou.id],
      rules: [{ action: "INTAKE_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] }]
    },
    {
      name: "演示·文书与归档审批",
      description: "案件文书、非案件文书审批与归档审批。",
      members: [users.ye.id, users.zhou.id],
      rules: [
        { action: "DOCUMENT_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] },
        { action: "DOCUMENT_APPROVE", caseScope: "NON_CASE", categories: [], sealTypes: [] },
        { action: "ARCHIVE_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] }
      ]
    },
    {
      name: "演示·开票审批",
      description: "财务开票审批与开具。",
      members: [users.ye.id, users.he.id],
      rules: [
        { action: "INVOICE_APPROVE", caseScope: "ALL_CASES", categories: [], sealTypes: [] },
        { action: "INVOICE_APPROVE", caseScope: "NON_CASE", categories: [], sealTypes: [] }
      ]
    },
    {
      name: "演示·用章审批与盖章",
      description: "全部用章事项的审批与盖章回填。",
      members: [users.ye.id, users.zhou.id, users.wang.id],
      rules: (["SEAL_APPROVE", "SEAL_STAMP"] as const).flatMap((action) =>
        (["ALL_CASES", "NON_CASE"] as const).map((caseScope) => ({ action, caseScope, categories: [], allSealPurposes: true, sealTypes: [...sealTypes] }))
      )
    }
  ];
  for (const g of groups) {
    await prisma.approvalPermissionGroup.create({
      data: {
        name: g.name,
        description: g.description,
        members: { create: g.members.map((userId) => ({ userId })) },
        rules: { create: g.rules }
      }
    });
  }
  console.log("✓ 演示账号 6 个、团队 2 个、审批授权组 4 个");
  return users;
}

/* ───────────────────────── 材料 ───────────────────────── */

type DocInput = {
  matterId?: string;
  intakeId?: string;
  procedureId?: string;
  stageId?: string;
  folderId?: string;
  name: string;
  category: DocumentCategory;
  sourceOrigin?: DocumentSourceOrigin;
  sourceParty?: string;
  pages: string[][];
  uploadedById: string;
  status?: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "FILED";
  ocr?: "OCR" | "DOCX" | "FAILED" | "PENDING";
  createdAt?: Date;
  tags?: string[];
  archiveChecklistItemId?: string;
};

async function createDoc(input: DocInput) {
  const raw = makeDocx(input.name.replace(/\.docx$/, ""), input.pages);
  const enc = encryptBuffer(raw);
  const scope = input.matterId ? `m_${input.matterId}` : input.intakeId ? `i_${input.intakeId}` : "approval-demo";
  const path = await storage.writeFile(scope, enc.ciphertext);
  const text = input.pages.map((p) => p.join("\n")).join("\f");
  const failed = input.ocr === "FAILED";
  const pending = input.ocr === "PENDING";
  return prisma.document.create({
    data: {
      matterId: input.matterId,
      intakeId: input.intakeId,
      procedureId: input.procedureId,
      stageId: input.stageId,
      folderId: input.folderId,
      name: input.name,
      category: input.category,
      sourceOrigin: input.sourceOrigin,
      sourceParty: input.sourceParty,
      status: input.status ?? "APPROVED",
      textContent: failed || pending ? null : text,
      pageCount: input.pages.length,
      textSource: failed || pending ? (input.ocr === "FAILED" ? "OCR" : null) : input.ocr === "OCR" ? "OCR" : "DOCX",
      ocrStatus: failed ? "FAILED" : pending ? "PENDING" : "READY",
      path,
      mimeType: DOCX_MIME,
      size: raw.length,
      sha256: sha256(raw),
      encrypted: true,
      algorithm: enc.algorithm,
      iv: enc.iv.toString("base64"),
      authTag: enc.authTag.toString("base64"),
      tags: input.tags ?? [],
      uploadedById: input.uploadedById,
      createdAt: input.createdAt ?? day(-10),
      archiveChecklistItemId: input.archiveChecklistItemId
    }
  });
}

/* ───────────────────────── 客户 ───────────────────────── */

type ClientSpec = {
  key: string;
  name: string;
  type: ClientType;
  idType?: "USCC" | "ID_CARD";
  idNumber?: string;
  source: string;
  status: "POTENTIAL" | "NEGOTIATING" | "SIGNED" | "TERMINATED";
  industry?: string;
  legalRep?: string;
  address: string;
  phone?: string;
  email?: string;
  gender?: "MALE" | "FEMALE";
  ethnicity?: string;
  tags?: string[];
  notes?: string;
  createdAt: Date;
  contacts?: { name: string; title?: string; phone?: string; email?: string; isPrimary?: boolean }[];
};

async function seedClients() {
  const specs: ClientSpec[] = [
    {
      key: "qingshi", name: "上海青石建设有限公司", type: "COMPANY", idType: "USCC", idNumber: uscc("91310115MA1K4X8P2"), source: "老客户转介", status: "SIGNED",
      industry: "建筑业", legalRep: "王建国", address: "上海市长宁区天山路 600 弄 3 号", phone: "021-62580001", email: "legal@qingshi-demo.cn",
      tags: ["重点客户", "工程类"], notes: "2023 年起合作，工程款回收类案件为主。", createdAt: day(-480),
      contacts: [
        { name: "王建国", title: "法定代表人", phone: "13800136690", email: "wangjg@qingshi-demo.cn", isPrimary: true },
        { name: "刘晓芸", title: "财务主管", phone: "13700132318", email: "liuxy@qingshi-demo.cn" }
      ]
    },
    {
      key: "qingshiDup", name: "上海青石建设有限公司", type: "COMPANY", source: "市场合作", status: "POTENTIAL", industry: "建筑业",
      address: "上海市长宁区", notes: "2024 年行业展会登记的潜在客户，未补录证件；疑似与已签约档案为同一主体，待合并。", createdAt: day(-300)
    },
    {
      key: "bank", name: "长城商业银行股份有限公司上海分行", type: "COMPANY", idType: "USCC", idNumber: uscc("91310000MA1FL3Q7B"), source: "市场合作", status: "SIGNED",
      industry: "金融业", legalRep: "赵启明", address: "上海市浦东新区陆家嘴环路 1000 号", tags: ["常年顾问"], notes: "办理经营性物业抵押贷款合作行，2026 年度常年顾问。", createdAt: day(-260),
      contacts: [{ name: "孙蕾", title: "法务部经理", phone: "13917650088", email: "sunlei@gwbank-demo.cn", isPrimary: true }]
    },
    {
      key: "dinghui", name: "鼎晖创投（上海）股权投资管理有限公司", type: "COMPANY", idType: "USCC", idNumber: uscc("91310101MA1G8K2D5"), source: "市场合作", status: "SIGNED",
      industry: "投资管理", legalRep: "郑一帆", address: "上海市黄浦区中山东二路 88 号", createdAt: day(-90),
      contacts: [{ name: "郑一帆", title: "投资总监", phone: "13661880123", isPrimary: true }]
    },
    {
      key: "linxy", name: "林晓芸", type: "INDIVIDUAL", idType: "ID_CARD", idNumber: idCard("31010519900312402"), source: "自然来访", status: "SIGNED",
      gender: "FEMALE", ethnicity: "汉族", address: "上海市长宁区仙霞路 99 弄", phone: "13585550123", createdAt: day(-60)
    },
    {
      key: "huachen", name: "华辰贸易（深圳）有限公司", type: "COMPANY", idType: "USCC", idNumber: uscc("91440300MA5F2C6R1"), source: "老客户转介", status: "SIGNED",
      industry: "批发和零售业", legalRep: "何俊", address: "深圳市南山区科技园科苑路 15 号", createdAt: day(-320),
      contacts: [{ name: "何俊", title: "总经理", phone: "13823360099", isPrimary: true }]
    },
    {
      key: "zhangwei", name: "张伟", type: "INDIVIDUAL", idType: "ID_CARD", idNumber: idCard("32050219850721351"), source: "家属委托", status: "SIGNED",
      gender: "MALE", ethnicity: "汉族", address: "苏州市姑苏区干将西路", phone: "13962130456", notes: "由其配偶李娜代为委托，会见需提前预约看守所。", createdAt: day(-40)
    },
    {
      key: "hengfeng", name: "恒丰置业（苏州）有限公司", type: "COMPANY", idType: "USCC", idNumber: uscc("91320505MA1Q9W3E8"), source: "律所官网", status: "SIGNED",
      industry: "房地产业", legalRep: "吴海", address: "苏州市虎丘区狮山路 28 号", createdAt: day(-150)
    },
    {
      key: "shengtong", name: "盛通物流有限公司", type: "COMPANY", idType: "USCC", idNumber: uscc("91310112MA1H7T4L6"), source: "老客户转介", status: "SIGNED",
      industry: "交通运输业", legalRep: "冯涛", address: "上海市闵行区申昆路 1899 号", createdAt: day(-400)
    },
    {
      key: "wangfang", name: "王芳", type: "INDIVIDUAL", idType: "ID_CARD", idNumber: idCard("31011019880915262"), source: "自然来访", status: "POTENTIAL",
      gender: "FEMALE", address: "上海市杨浦区控江路", phone: "13601770321", createdAt: day(-6)
    },
    {
      key: "yuanhang", name: "远航科技（杭州）有限公司", type: "COMPANY", idType: "USCC", idNumber: uscc("91330106MA2H6N5K9"), source: "市场合作", status: "NEGOTIATING",
      industry: "信息技术", legalRep: "钱锋", address: "杭州市西湖区文三路 478 号", createdAt: day(-8),
      contacts: [{ name: "钱锋", title: "董事长", phone: "13588120077", isPrimary: true }]
    },
    {
      key: "zhongcheng", name: "众诚餐饮管理有限公司", type: "COMPANY", idType: "USCC", idNumber: uscc("91310106MA1J3P8R2"), source: "律所官网", status: "NEGOTIATING",
      industry: "住宿和餐饮业", legalRep: "韩梅", address: "上海市静安区南京西路 1618 号", createdAt: day(-12)
    },
    {
      key: "chenming", name: "陈明", type: "INDIVIDUAL", idType: "ID_CARD", idNumber: idCard("31010419800101123"), source: "自然来访", status: "TERMINATED",
      gender: "MALE", address: "上海市徐汇区漕溪北路", phone: "13816880012", createdAt: sh(SH_TODAY.y - 1, 3, 3)
    }
  ];
  const out: Record<string, { id: string; name: string; type: ClientType; idPlain?: string }> = {};
  for (const s of specs) {
    const c = await prisma.client.create({
      data: {
        name: s.name,
        type: s.type,
        idType: s.idType,
        ...(s.idNumber ? sealIdNumber(s.idNumber) : {}),
        address: s.address,
        phone: s.phone,
        email: s.email,
        source: s.source,
        tags: s.tags ?? [],
        notes: s.notes,
        legalRep: s.legalRep,
        internalCode: await generateClientCode(),
        cooperationStatus: s.status,
        industry: s.industry,
        gender: s.gender,
        ethnicity: s.ethnicity,
        createdAt: s.createdAt,
        contacts: s.contacts ? { create: s.contacts.map((ct) => ({ ...ct, isPrimary: ct.isPrimary ?? false })) } : undefined
      }
    });
    out[s.key] = { id: c.id, name: c.name, type: c.type, idPlain: s.idNumber };
  }
  console.log(`✓ 客户 ${specs.length} 个（含 1 组疑似重复档案）`);
  return out;
}

/* ───────────────────────── 案件骨架 ───────────────────────── */

type PartySpec = { role: PartyRole; standing?: LitigationStanding; name: string; partyType: PartyType; idNumber?: string; social?: string; legalRep?: string; address?: string; phone?: string };

async function causeId(category: MatterCategory, name: string) {
  const c = await prisma.causeOfAction.findFirst({ where: { category, name, active: true }, select: { id: true } });
  return c?.id ?? null;
}

async function createMatter(opts: {
  title: string;
  category: MatterCategory;
  status?: "PENDING_ACCEPTANCE" | "IN_PROGRESS" | "ON_HOLD" | "CLOSED" | "ARCHIVED";
  serviceStatus?: "SERVICE_ACTIVE" | "SERVICE_COMPLETED";
  client: { id: string; name: string };
  ownerId: string;
  registeredById?: string;
  members?: { userId: string; role: "CO_LEAD" | "ASSISTANT" }[];
  cause?: string;
  causeFreeText?: string;
  claimAmount?: number;
  ourStanding?: LitigationStanding;
  intakeDate: Date;
  intakeId?: string;
  teamAccessRestricted?: boolean;
  closedAt?: Date;
  archivedAt?: Date;
  extra?: Partial<Prisma.MatterUncheckedCreateInput>;
  parties: PartySpec[];
}) {
  const m = await prisma.matter.create({
    data: {
      internalCode: await generateInternalCode(opts.category),
      firmCaseNo: await generateFirmCaseNo(opts.category),
      title: opts.title,
      category: opts.category,
      status: opts.status ?? "IN_PROGRESS",
      serviceStatus: opts.serviceStatus ?? "SERVICE_ACTIVE",
      teamAccessRestricted: opts.teamAccessRestricted ?? false,
      causeId: opts.cause ? await causeId(opts.category === "LABOR_ARBITRATION" || opts.category === "COMMERCIAL_ARBITRATION" ? "CIVIL_COMMERCIAL" : opts.category, opts.cause) : null,
      causeFreeText: opts.causeFreeText ?? (opts.cause && !(await causeId(opts.category === "LABOR_ARBITRATION" || opts.category === "COMMERCIAL_ARBITRATION" ? "CIVIL_COMMERCIAL" : opts.category, opts.cause)) ? opts.cause : null),
      claimAmount: opts.claimAmount,
      ourStanding: opts.ourStanding,
      intakeDate: opts.intakeDate,
      intakeId: opts.intakeId,
      primaryClientId: opts.client.id,
      ownerId: opts.ownerId,
      registeredById: opts.registeredById ?? opts.ownerId,
      firstAcceptedAt: opts.status === "PENDING_ACCEPTANCE" ? null : opts.intakeDate,
      closedAt: opts.closedAt,
      archivedAt: opts.archivedAt,
      createdAt: opts.intakeDate,
      members: { create: [{ userId: opts.ownerId, role: "LEAD" as const }, ...(opts.members ?? [])] },
      clientLinks: { create: { clientId: opts.client.id, isPrimary: true, label: "主要委托方" } },
      ...opts.extra
    }
  });
  const parties: Record<string, string> = {};
  for (const [i, p] of opts.parties.entries()) {
    const party = await prisma.party.create({
      data: {
        matterId: m.id,
        role: p.role,
        standing: p.standing,
        ordinal: i + 1,
        name: p.name,
        partyType: p.partyType,
        idNumber: p.idNumber,
        enterpriseSocialCode: p.social,
        enterpriseName: p.social ? p.name : null,
        legalRep: p.legalRep,
        address: p.address,
        phone: p.phone
      }
    });
    parties[p.name] = party.id;
  }
  await prisma.$transaction((tx) => seedDefaultFolders(tx, m.id, opts.category));
  await prisma.timelineEvent.create({ data: { matterId: m.id, eventType: "MATTER_CREATED", title: opts.intakeId ? "案件已创建（来自收案审批）" : "案件已创建", occurredAt: opts.intakeDate } });
  return { ...m, parties };
}

/** 程序 + 环节（currentIndex 之前的必备环节标记完成） */
async function createProcedure(opts: {
  matterId: string;
  type: ProcedureType;
  order: number;
  status: "PENDING" | "IN_PROGRESS" | "CONCLUDED";
  leadLawyerId: string;
  caseNumber?: string;
  handlingAgency?: string;
  jurisdiction?: string;
  presidingJudge?: string;
  judgeAssistant?: string;
  judgeAssistantContact?: string;
  ourStanding?: LitigationStanding;
  acceptedAt?: Date;
  concludedAt?: Date;
  outcome?: "WON" | "PARTIAL_WON" | "LOST" | "MEDIATED" | "COMPLETED";
  outcomeNote?: string;
  currentStage: string;
  optionalStages?: string[];
  partyStandings?: { partyId: string; standing: LitigationStanding }[];
  startedAt: Date;
}) {
  const p = await prisma.matterProcedure.create({
    data: {
      matterId: opts.matterId,
      type: opts.type,
      engagement: "ENGAGED",
      order: opts.order,
      status: opts.status,
      caseNumber: opts.caseNumber,
      handlingAgency: opts.handlingAgency,
      jurisdiction: opts.jurisdiction,
      presidingJudge: opts.presidingJudge,
      judgeAssistant: opts.judgeAssistant,
      judgeAssistantContact: opts.judgeAssistantContact,
      ourStanding: opts.ourStanding,
      leadLawyerId: opts.leadLawyerId,
      acceptedAt: opts.acceptedAt,
      concludedAt: opts.concludedAt,
      outcome: opts.outcome,
      outcomeNote: opts.outcomeNote
    }
  });
  const presets = procedureStagePresetsForProcedure(opts.type).filter((s) => s.kind === "required" || opts.optionalStages?.includes(s.name));
  const curIdx = opts.status === "CONCLUDED" ? presets.length : Math.max(0, presets.findIndex((s) => s.name === opts.currentStage));
  const stages: Record<string, string> = {};
  for (const [i, s] of presets.entries()) {
    const st = await prisma.matterStage.create({
      data: {
        procedureId: p.id,
        name: s.name,
        description: s.description,
        order: i + 1,
        startedAt: i <= curIdx ? new Date(opts.startedAt.getTime() + i * 6 * DAY) : null,
        completedAt: i < curIdx ? new Date(opts.startedAt.getTime() + (i + 1) * 6 * DAY) : null
      }
    });
    stages[s.name] = st.id;
  }
  if (opts.partyStandings?.length) {
    await prisma.procedureParty.createMany({ data: opts.partyStandings.map((ps, i) => ({ procedureId: p.id, partyId: ps.partyId, standing: ps.standing, ordinal: i + 1 })) });
  }
  return { ...p, stages };
}

async function ruleId(code: string) {
  return (await prisma.deadlineRule.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
}

async function audit(userId: string, action: string, targetType: string, targetId: string, at: Date, detail: Record<string, unknown> = {}) {
  await prisma.auditLog.create({ data: { userId, action, targetType, targetId, createdAt: at, detail: { ...detail, demoSeed: true } as Prisma.InputJsonValue } });
}

async function folderId(matterId: string, name: string) {
  return (await prisma.documentFolder.findFirst({ where: { matterId, name }, select: { id: true } }))?.id;
}

async function conflictCheckFor(intakeId: string | null, queries: QueryItem[], by: string, at: Date, conclusion?: { value: "SAME_SUBJECT" | "DIFFERENT" | "NEED_INFO"; note: string }) {
  const result = await runConflictCheck(queries);
  const noHits = result.hits.length === 0;
  const check = await prisma.conflictCheck.create({
    data: {
      intakeId,
      queryPayload: { queries, sameNameClients: result.sameNameClients, idMatchedClients: result.idMatchedClients } as object,
      conclusion: conclusion?.value ?? (noHits ? "DIFFERENT" : "PENDING"),
      decidedById: conclusion || noHits ? by : null,
      decidedAt: conclusion || noHits ? at : null,
      note: conclusion?.note ?? (noHits ? "系统自动标记：未命中历史案件冲突。" : null),
      checkedAt: at,
      hits: {
        create: result.hits.map((h) => ({ hitType: h.hitType, targetType: h.targetType, targetId: h.targetId, matchedName: h.matchedName, matchedField: h.matchedField, matchedValue: h.matchedValue, matchedRatio: h.matchedRatio, severity: h.severity, reason: h.reason }))
      }
    }
  });
  await audit(by, "CONFLICT_CHECK_RUN", "ConflictCheck", check.id, at, { intakeId, hitCount: result.hits.length });
  return check;
}

/* ───────────────────────── 主流程 ───────────────────────── */

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error("此脚本会清空客户/收案/案件等全部业务数据。确认执行请追加 --confirm");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
    console.error("为安全起见，仅允许在本机数据库（localhost）执行。");
    process.exit(1);
  }

  await wipe();
  const U = await seedUsers();
  const C = await seedClients();
  const year = SH_TODAY.y;

  /* ── 律所资料 / 归档制度 ── */
  const firmFileSpecs: { name: string; category: "POLICY" | "GUIDE" | "TEMPLATE" | "CONTRACT" | "LETTER" | "LICENSE" | "REFERENCE"; description: string; lines: string[]; tags: string[] }[] = [
    { name: `律师事务所业务档案管理办法（${year}版）.docx`, category: "POLICY", description: "归档范围、立卷要求、保管期限与借阅规则。", tags: ["归档", "制度"], lines: ["第一条 为规范本所业务档案管理，依据《律师业务档案立卷归档办法》制定本办法。", "第二条 案件办结后三十日内由主办律师提交归档申请。", "第三条 归档材料按收案、委托、诉讼文书、证据、裁判、结案顺序排列。"] },
    { name: "利益冲突审查制度.docx", category: "POLICY", description: "收案前冲突检索、结论判定与例外审批。", tags: ["收案", "冲突"], lines: ["一、所有收案须在审批前完成利益冲突检索。", "二、命中阻塞级冲突的，未经主任律师书面同意不得收案。"] },
    { name: "员工手册（2026年版）.docx", category: "POLICY", description: "考勤、保密、执业纪律与报销。", tags: ["人事"], lines: ["第一章 总则", "第二章 保密义务：不得在个人设备存储当事人敏感信息。"] },
    { name: "诉讼案件办案质量指引.docx", category: "GUIDE", description: "从收案到结案的关键节点与质量要求。", tags: ["办案"], lines: ["1. 立案后三日内完成案情研判笔记。", "2. 举证期限届满前七日完成证据清单复核。"] },
    { name: "委托代理合同（诉讼·参考范本）.docx", category: "TEMPLATE", description: "律师下载后按案件修改的参考范本。", tags: ["合同"], lines: ["甲方（委托人）：", "乙方（受托人）：", "第一条 委托事项"] },
    { name: "办公场所租赁合同.docx", category: "CONTRACT", description: "律所办公场所租赁合同（2025—2028）。", tags: ["行政"], lines: ["出租方：上海某置业有限公司（虚构）", "租期：三年"] },
    { name: "律师事务所函（空白格式）.docx", category: "LETTER", description: "所函标准格式。", tags: ["函件"], lines: ["致：", "兹有我所律师……"] },
    { name: "律师事务所执业许可证（副本）.docx", category: "LICENSE", description: "执业许可证副本扫描件（演示用文字版）。", tags: ["证照"], lines: ["执业许可证号：31010000000000000（虚构）"] }
  ];
  const firmFiles: Record<string, { id: string; name: string; sha: string }> = {};
  for (const [i, f] of firmFileSpecs.entries()) {
    const buf = makeDocx(f.name.replace(/\.docx$/, ""), [f.lines]);
    const path = await storage.writeFile("firm-files", buf);
    const row = await prisma.firmFile.create({ data: { name: f.name, description: f.description, category: f.category, tags: f.tags, path, mimeType: DOCX_MIME, size: buf.length, sha256: sha256(buf), uploadedById: U.wang.id, createdAt: day(-200 + i * 10) } });
    firmFiles[f.category + i] = { id: row.id, name: row.name, sha: row.sha256! };
  }
  const policyFile = firmFiles.POLICY0;
  await prisma.systemSetting.create({
    data: {
      key: "archivePolicy",
      value: { schemaVersion: 1, configured: true, name: "律师事务所业务档案管理办法", version: `${year} 版`, effectiveAt: `${year}-01-01`, sourceFileId: policyFile.id, confirmedAt: day(-180).toISOString(), confirmedById: U.ye.id }
    }
  });

  /* ── 自定义字段 ── */
  await prisma.customFieldDef.createMany({
    data: [
      { entityType: "MATTER", key: "opposingFirm", label: "对方代理律所", fieldType: "TEXT", order: 1 },
      { entityType: "MATTER", key: "riskLevel", label: "案件风险等级", fieldType: "SELECT", options: ["低", "中", "高"], order: 2 },
      { entityType: "MATTER", key: "courtLevel", label: "承办法院层级", fieldType: "SELECT", options: ["基层法院", "中级法院", "高级法院"], order: 3 }
    ]
  });

  /* ═══════════════ M1 青石建设诉华东置业（主演示案件：几乎所有功能） ═══════════════ */
  const intakeM1 = await prisma.intake.create({
    data: {
      title: "上海青石建设有限公司诉华东置业有限公司建设工程施工合同纠纷",
      category: "CIVIL_COMMERCIAL",
      causeId: await causeId("CIVIL_COMMERCIAL", "建设工程施工合同纠纷"),
      description: "青石建设承建华东置业「虹桥商务广场」项目，竣工验收后尚欠工程款 458 万元，对方以工期延误为由拒付。",
      status: "CONVERTED",
      receivedAt: day(-75),
      clientId: C.qingshi.id,
      clientType: "COMPANY",
      contactName: "王建国",
      contactPhone: "13800136690",
      firstProcedureType: "FIRST_INSTANCE",
      firstAgency: "上海市长宁区人民法院",
      jurisdiction: "上海市/长宁区",
      ourStanding: "PLAINTIFF",
      claimAmount: 4580000,
      barFiling: "NONE",
      feeType: "FIXED",
      feeAmount: 380000,
      feeSchedule: "签约付 150,000；立案后 30 日内付 120,000；一审判决后付 110,000",
      ownerUserId: U.ye.id,
      coUserIds: [U.shen.id],
      createdById: U.shen.id,
      parties: { create: [{ role: "OPPOSING_PARTY", standing: "DEFENDANT", name: "华东置业有限公司", partyType: "COMPANY", enterpriseSocialCode: uscc("91310105MA1B2C3D4"), legalRep: "陆志远" }] }
    }
  });
  await audit(U.shen.id, "INTAKE_RESUBMIT", "Intake", intakeM1.id, day(-75, 10), { note: "提交收案审批" });
  await audit(U.zhou.id, "INTAKE_CONVERT", "Intake", intakeM1.id, day(-74, 15), { note: "冲突检索无命中，同意收案并转为案件" });

  const m1 = await createMatter({
    title: "上海青石建设有限公司诉华东置业有限公司建设工程施工合同纠纷",
    category: "CIVIL_COMMERCIAL",
    client: C.qingshi,
    ownerId: U.ye.id,
    registeredById: U.shen.id,
    members: [{ userId: U.shen.id, role: "CO_LEAD" }, { userId: U.chen.id, role: "ASSISTANT" }],
    cause: "建设工程施工合同纠纷",
    claimAmount: 4580000,
    ourStanding: "PLAINTIFF",
    intakeDate: day(-74),
    intakeId: intakeM1.id,
    extra: { barFiling: "NONE", customValues: { opposingFirm: "上海衡正律师事务所", riskLevel: "中", courtLevel: "基层法院" } },
    parties: [
      { role: "CLIENT_PARTY", standing: "PLAINTIFF", name: C.qingshi.name, partyType: "COMPANY", social: C.qingshi.idPlain, legalRep: "王建国", address: "上海市长宁区天山路 600 弄 3 号" },
      { role: "OPPOSING_PARTY", standing: "DEFENDANT", name: "华东置业有限公司", partyType: "COMPANY", social: uscc("91310105MA1B2C3D4"), legalRep: "陆志远", address: "上海市徐汇区虹桥路 1 号" },
      { role: "THIRD_PARTY", standing: "THIRD_PARTY", name: "上海华东物业服务有限公司", partyType: "COMPANY", social: uscc("91310104MA1C9E8F1") }
    ]
  });
  const p1 = await createProcedure({
    matterId: m1.id, type: "FIRST_INSTANCE", order: 1, status: "IN_PROGRESS", leadLawyerId: U.ye.id,
    caseNumber: `(${year})沪0105民初4421号`, handlingAgency: "上海市长宁区人民法院", jurisdiction: "上海市/长宁区",
    presidingJudge: "李敏", judgeAssistant: "周立", judgeAssistantContact: "021-52110000-2231", ourStanding: "PLAINTIFF",
    acceptedAt: day(-60), currentStage: "举证质证", optionalStages: ["财产保全", "庭前会议"], startedAt: day(-72),
    partyStandings: [
      { partyId: m1.parties[C.qingshi.name], standing: "PLAINTIFF" },
      { partyId: m1.parties["华东置业有限公司"], standing: "DEFENDANT" },
      { partyId: m1.parties["上海华东物业服务有限公司"], standing: "THIRD_PARTY" }
    ]
  });
  await prisma.deadline.createMany({
    data: [
      { procedureId: p1.id, title: "举证期限届满", category: "EVIDENCE", dueAt: day(3, 17), basis: "举证通知书载明：自收到通知之日起三十日内", remindDays: 7, sourceRuleId: await ruleId("CIVIL_EVIDENCE_PERIOD"), startFact: "收到举证通知书", confirmStatus: "CONFIRMED" },
      { procedureId: p1.id, title: "提交工程造价鉴定申请", category: "CUSTOM", dueAt: day(-1, 17), basis: "庭前会议确定：鉴定申请于会后十日内提交", remindDays: 3, confirmStatus: "ADJUSTED", adjustedById: U.shen.id, adjustedAt: day(-8) },
      { procedureId: p1.id, title: "银行存款冻结续封申请", category: "PRESERVATION", dueAt: day(18, 17), basis: "冻结期限一年，届满前申请续封", remindDays: 15, confirmStatus: "PENDING" },
      { procedureId: p1.id, title: "起诉状副本送达后被告答辩期", category: "RESPONSE", dueAt: day(-40, 17), basis: "《民事诉讼法》第一百二十八条：十五日", completed: true, completedAt: day(-40) }
    ]
  });
  await prisma.hearing.createMany({
    data: [
      { procedureId: p1.id, title: "开庭 · 第一次庭审", room: "第七法庭", address: "上海市长宁区平塘路 1 号", judge: "李敏", contact: "021-52110000-2231", startsAt: day(5, 9, 30), endsAt: day(5, 12), notes: "携带施工合同、结算书原件；王建国出庭" },
      { procedureId: p1.id, title: "庭前会议（证据交换）", room: "第三调解室", judge: "李敏", startsAt: day(-12, 14), endsAt: day(-12, 16), notes: "已完成证据交换，对方提交工期延误证据 12 份" }
    ]
  });
  await prisma.procedureMemo.createMany({
    data: [
      { procedureId: p1.id, content: "开庭前与王建国确认结算书签收人", createdById: U.ye.id },
      { procedureId: p1.id, content: "向法院调取竣工验收备案表", done: true, doneAt: day(-20), createdById: U.shen.id }
    ]
  });
  await prisma.task.createMany({
    data: [
      { matterId: m1.id, stageId: p1.stages["举证质证"], title: "整理对方 12 份证据的质证意见", assigneeId: U.shen.id, dueAt: day(1, 18), priority: 2 },
      { matterId: m1.id, stageId: p1.stages["举证质证"], title: "联系三家工程造价鉴定机构询价", assigneeId: U.chen.id, dueAt: day(-2, 18), priority: 1 },
      { matterId: m1.id, stageId: p1.stages["开庭审理"], title: "撰写庭审发问提纲与代理意见要点", assigneeId: U.ye.id, dueAt: day(4, 18), priority: 1 },
      { matterId: m1.id, stageId: p1.stages["起诉立案"], title: "提交立案材料并缴纳诉讼费", assigneeId: U.chen.id, dueAt: day(-62), completed: true, completedAt: day(-61) }
    ]
  });
  const litFolder = await folderId(m1.id, "证据材料");
  const d1 = {
    complaint: await createDoc({ matterId: m1.id, procedureId: p1.id, stageId: p1.stages["起诉立案"], name: "民事起诉状.docx", category: "PLEADING", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.shen.id, createdAt: day(-64), archiveChecklistItemId: "pleading", pages: [["原告：上海青石建设有限公司", "被告：华东置业有限公司", "诉讼请求：一、判令被告支付工程款人民币 4,580,000 元及逾期付款利息；二、确认原告就工程折价或拍卖价款享有优先受偿权。"], ["事实与理由：原被告于 2023 年签订《建设工程施工合同》，工程已于 2025 年 8 月竣工验收……"]] }),
    contract: await createDoc({ matterId: m1.id, procedureId: p1.id, stageId: p1.stages["代理授权"], folderId: litFolder, name: "建设工程施工合同.docx", category: "CONTRACT", sourceOrigin: "CLIENT_PROVIDED", sourceParty: C.qingshi.name, uploadedById: U.chen.id, createdAt: day(-73), pages: [["发包人：华东置业有限公司", "承包人：上海青石建设有限公司", "工程名称：虹桥商务广场一期"], ["第十四条 工程款支付：竣工验收合格后 60 日内支付至结算价的 95%。", "第十六条 工期延误违约金按每日万分之三计算。"]] }),
    mortgage: await createDoc({ matterId: m1.id, procedureId: p1.id, stageId: p1.stages["举证质证"], folderId: litFolder, name: "最高额抵押合同（盖章版）.docx", category: "EVIDENCE", sourceOrigin: "CLIENT_PROVIDED", sourceParty: C.qingshi.name, uploadedById: U.chen.id, createdAt: day(-30), pages: [["抵押权人：长城商业银行股份有限公司上海分行", "抵押人：华东置业有限公司"], ["第三条 抵押财产为虹桥路 88 号 1-3 层商业用房及其占用范围内土地使用权。"], ["第四条 抵押担保范围：主债权本金、利息、违约金及实现债权的费用。"], ["第九条 抵押期间未经抵押权人同意，抵押人不得转让抵押财产。"]] }),
    registry: await createDoc({ matterId: m1.id, procedureId: p1.id, stageId: p1.stages["举证质证"], folderId: litFolder, name: "不动产登记信息查询结果.docx", category: "EVIDENCE", sourceOrigin: "SELF_COLLECTED", uploadedById: U.chen.id, ocr: "OCR", createdAt: day(-28), pages: [["登记证明：证明权利事项为抵押权登记，权利人长城商业银行上海分行，义务人华东置业有限公司。", "不动产坐落：虹桥路 88 号 1-3 层"]] }),
    acceptance: await createDoc({ matterId: m1.id, procedureId: p1.id, stageId: p1.stages["起诉立案"], name: "受理案件通知书.docx", category: "PROCEDURE", sourceOrigin: "COURT_SERVED", uploadedById: U.chen.id, createdAt: day(-60), pages: [[`上海市长宁区人民法院 受理案件通知书 (${year})沪0105民初4421号`, "你方起诉被告华东置业有限公司建设工程施工合同纠纷一案，本院已立案受理。"]] }),
    evidenceNotice: await createDoc({ matterId: m1.id, procedureId: p1.id, stageId: p1.stages["举证质证"], name: "举证通知书.docx", category: "PROCEDURE", sourceOrigin: "COURT_SERVED", uploadedById: U.chen.id, createdAt: day(-27), pages: [["当事人应当在收到本通知之日起三十日内向本院提交证据。逾期提交的，承担相应法律后果。"]] }),
    settlementScan: await createDoc({ matterId: m1.id, procedureId: p1.id, stageId: p1.stages["举证质证"], folderId: litFolder, name: "工程结算审核报告（扫描件）.docx", category: "EVIDENCE", sourceOrigin: "CLIENT_PROVIDED", uploadedById: U.chen.id, ocr: "FAILED", createdAt: day(-25), pages: [["（扫描件识别失败：页面倾斜且印章遮挡）"]] }),
    lawyerLetter: await createDoc({ matterId: m1.id, procedureId: p1.id, stageId: p1.stages["举证质证"], name: "律师函（致华东置业有限公司·催告履行）.docx", category: "OTHER", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.shen.id, status: "PENDING_REVIEW", createdAt: day(-1), pages: [["华东置业有限公司：", "受上海青石建设有限公司委托，就贵司拖欠工程款事宜致函如下……请于收函之日起七日内支付欠付工程款 458 万元。"]] }),
    crossExam: await createDoc({ matterId: m1.id, procedureId: p1.id, stageId: p1.stages["举证质证"], name: "质证意见（草稿）.docx", category: "PLEADING", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.shen.id, status: "DRAFT", createdAt: day(-2), pages: [["对被告证据 1《工期签证单》的真实性无异议，但对证明目的有异议：签证单载明延误系设计变更所致……"]] }),
    poa: await createDoc({ matterId: m1.id, procedureId: p1.id, stageId: p1.stages["代理授权"], name: "授权委托书.docx", category: "PROCEDURE", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.chen.id, createdAt: day(-73), archiveChecklistItemId: "power_of_attorney", pages: [["委托人：上海青石建设有限公司", "受托人：叶森、沈青，系本所律师", "代理权限：特别授权"]] })
  };
  await audit(U.shen.id, "DOCUMENT_SUBMIT_REVIEW", "Document", d1.lawyerLetter.id, day(-1, 11), { note: "请审核后用印发出" });
  await prisma.note.createMany({
    data: [
      { matterId: m1.id, authorId: U.shen.id, channel: "PHONE", withWhom: "王建国", occurredAt: day(-3, 15), content: "与王建国确认：结算书签收人为项目经理张磊，可出庭作证；客户同意申请造价鉴定，费用先行垫付。", tags: ["环节:举证质证"] },
      { matterId: m1.id, authorId: U.chen.id, channel: "COURT", withWhom: "周立（法官助理）", occurredAt: day(-6, 10), content: "法官助理电话告知：开庭时间确定，鉴定申请须在庭前提交，逾期视为放弃。", tags: ["环节:举证质证"] },
      { matterId: m1.id, authorId: U.ye.id, channel: "MEETING", withWhom: "团队内部", occurredAt: day(-10, 17), content: "研判：本案争议焦点一为工期延误责任归属，二为结算价是否以审核报告为准。对方主张的违约金可与工程款抵销的风险较高，需补强设计变更证据。优先受偿权主张须注意六个月除斥期间。", tags: ["研判笔记", "环节:举证质证"] },
      { matterId: m1.id, authorId: U.ye.id, channel: "OTHER", occurredAt: day(-70, 11), content: "研判：诉讼时效与优先受偿权期间均未届满；建议同步申请诉讼保全，冻结被告银行存款 200 万元。", tags: ["研判笔记", "环节:案情研判"] }
    ]
  });
  await prisma.evidenceItem.createMany({
    data: [
      { matterId: m1.id, title: "竣工验收合格日期", content: "竣工验收备案表显示 2025 年 8 月 18 日验收合格，付款期限自该日起算。", kind: "FACT", sourceDocumentId: d1.contract.id, sourcePage: 2, createdById: U.shen.id },
      { matterId: m1.id, title: "被告主张工期延误 96 天", content: "被告答辩称延误 96 天应扣违约金约 130 万元。", kind: "CLAIM", createdById: U.shen.id },
      { matterId: m1.id, title: "延误责任归属", content: "签证单显示延误主要由设计变更导致，属发包人原因。", kind: "ISSUE", createdById: U.ye.id },
      { matterId: m1.id, title: "结算审核报告原件", content: "扫描件识别失败，需向客户调取清晰原件。", kind: "TODO_VERIFY", sourceDocumentId: d1.settlementScan.id, createdById: U.chen.id },
      { matterId: m1.id, title: "抵押登记影响优先受偿", content: "工程价款优先权优于银行抵押权，但须在期限内主张。", kind: "ANALYSIS", sourceDocumentId: d1.mortgage.id, sourcePage: 3, createdById: U.ye.id }
    ]
  });
  await prisma.relatedEntity.create({ data: { matterId: m1.id, name: "长城商业银行股份有限公司上海分行", relationship: "涉案房产抵押权人", notes: "本所常年顾问客户，涉及冲突审查时需注意" } });
  await prisma.reviewRecord.create({
    data: {
      matterId: m1.id, documentId: d1.contract.id, reviewedById: U.ye.id, reviewedAt: day(-65), itemCount: 3, textPreviewChars: 820, truncated: false,
      itemsJson: [
        { type: "RISK", severity: "HIGH", title: "工期违约金可能被用于抵销工程款", detail: "第十六条违约金按日计算且无上限，建议在诉讼中同步主张延误系发包人原因。" },
        { type: "MISSING", severity: "MEDIUM", title: "缺少结算审核的确认程序约定", detail: "合同未约定结算审核报告的确认时限，对方可能否认审核结果。" },
        { type: "SUGGESTION", severity: "LOW", title: "补充设计变更签证", detail: "建议补齐全部设计变更签证单作为证据。" }
      ]
    }
  });

  const engagementQ = await prisma.engagement.create({ data: { clientId: C.qingshi.id, title: "青石建设工程款回收诉讼委托", scopeText: "一审代理、诉讼保全、造价鉴定程序", feeNote: "固定收费 38 万元，分三期支付", startedAt: day(-74) } });
  await prisma.engagementMatter.create({ data: { engagementId: engagementQ.id, matterId: m1.id, validFrom: day(-74) } });
  const billing1 = await prisma.billing.create({ data: { engagementId: engagementQ.id, matterId: m1.id, title: "委托代理合同 - 固定收费", contractAmount: 380000, schedule: "签约付 150,000；立案后 30 日内付 120,000；一审判决后付 110,000", status: "ACTIVE", signedAt: day(-74) } });
  await prisma.commissionPlan.createMany({ data: [{ matterId: m1.id, userId: U.ye.id, percent: 30, label: "主办" }, { matterId: m1.id, userId: U.shen.id, percent: 20, label: "协办" }] });
  const r1a = await prisma.receivable.create({ data: { matterId: m1.id, billingId: billing1.id, title: "首期律师费", amount: 150000, settledAmount: 150000, status: "SETTLED", dueDate: day(-70) } });
  await prisma.receivable.create({ data: { matterId: m1.id, billingId: billing1.id, title: "第二期律师费（立案后 30 日）", amount: 120000, status: "OPEN", dueDate: day(-45) } });
  await prisma.receivable.create({ data: { matterId: m1.id, billingId: billing1.id, title: "尾款（一审判决后）", amount: 110000, status: "OPEN", dueDate: day(120) } });
  const fe1 = await prisma.feeEntry.create({ data: { matterId: m1.id, billingId: billing1.id, type: "RECEIVED", amount: 150000, occurredAt: day(-70), invoiceNo: "31002600001234", payerOrPayee: C.qingshi.name, method: "银行转账", note: "首期律师费", recordedById: U.he.id } });
  await prisma.feeEntry.createMany({
    data: [
      { matterId: m1.id, billingId: billing1.id, type: "COMMISSION", amount: 45000, occurredAt: day(-68), parentFeeEntryId: fe1.id, beneficiaryUserId: U.ye.id, note: "主办分成 30%", recordedById: U.he.id },
      { matterId: m1.id, billingId: billing1.id, type: "COMMISSION", amount: 30000, occurredAt: day(-68), parentFeeEntryId: fe1.id, beneficiaryUserId: U.shen.id, note: "协办分成 20%", recordedById: U.he.id },
      { matterId: m1.id, billingId: billing1.id, type: "RECEIVABLE", amount: 120000, occurredAt: day(-45), payerOrPayee: C.qingshi.name, note: "第二期律师费（已逾期）", recordedById: U.he.id },
      { matterId: m1.id, type: "COST", amount: 23870, occurredAt: day(-61), payerOrPayee: "上海市长宁区人民法院", method: "代垫", note: "案件受理费（客户已转付）", recordedById: U.chen.id }
    ]
  });
  const pay1 = await prisma.payment.create({ data: { matterId: m1.id, feeEntryId: fe1.id, amount: 150000, allocatedAmount: 150000, status: "FULLY_ALLOCATED", occurredAt: day(-70), recordedById: U.he.id } });
  await prisma.allocation.create({ data: { paymentId: pay1.id, receivableId: r1a.id, amount: 150000, allocatedById: U.he.id } });
  const inv1 = await prisma.invoiceRequest.create({
    data: {
      matterId: m1.id, amount: 120000, title: "第二期律师费", status: "PENDING", requestNote: "客户要求先开票后付款，已与主任沟通", invoiceType: "SPECIAL", invoiceItem: "LAWYER_FEE",
      buyerName: C.qingshi.name, buyerTaxNo: C.qingshi.idPlain, buyerAddress: "上海市长宁区天山路 600 弄 3 号", buyerPhone: "021-62580001", buyerBank: "招商银行上海长宁支行", buyerBankAccount: "121900000000001",
      evidenceDocIds: [d1.contract.id], requestedById: U.shen.id, requestedAt: day(-1, 16)
    }
  });
  void inv1;
  const pc1 = await prisma.preservationCase.create({
    data: {
      matterId: m1.id, type: "LITIGATION", status: "ACTIVE", court: "上海市长宁区人民法院", rulingNumber: `(${year})沪0105财保112号`, guaranteeType: "GUARANTEE_LETTER", appliedAt: day(-345), ownerId: U.shen.id, note: "保函由平安财险出具",
      targets: {
        create: {
          name: "华东置业有限公司",
          properties: {
            create: [
              { propertyType: "BANK_DEPOSIT", propertyDetail: "招商银行上海徐汇支行 账号尾号 6612", amount: 2000000, startDate: day(-347), duration: 365, expiryDate: day(18), status: "ACTIVE" },
              { propertyType: "REAL_ESTATE", propertyDetail: "虹桥路 88 号 4 层商业用房（轮候查封）", amount: 3200000, startDate: day(-58), duration: 1095, expiryDate: day(1037), status: "ACTIVE" }
            ]
          }
        }
      }
    }
  });
  void pc1;
  await prisma.expressTracking.createMany({
    data: [
      { matterId: m1.id, trackingNo: "SF1409872263510", companyCode: "顺丰速运", direction: "OUTBOUND", purpose: "起诉状副本及证据寄长宁法院立案庭", recipient: "长宁法院立案庭", recipientPhone: "021-52110000", lastState: "已签收", lastUpdateAt: day(-62, 11), createdById: U.chen.id, createdAt: day(-64) },
      { matterId: m1.id, trackingNo: "1151238890475", companyCode: "EMS", direction: "INBOUND", purpose: "法院邮寄送达开庭传票", recipient: "叶森律师", lastState: "在途", lastUpdateAt: day(0, 8), createdById: U.chen.id, createdAt: day(-1) }
    ]
  });

  /* ═══════════════ M2 劳动争议（团队成员主办 → 团队只读视图） ═══════════════ */
  const m2 = await createMatter({
    title: "林晓芸与上海晟安人力资源有限公司劳动争议",
    category: "LABOR_ARBITRATION",
    client: C.linxy,
    ownerId: U.shen.id,
    members: [{ userId: U.chen.id, role: "ASSISTANT" }],
    cause: "劳动合同纠纷",
    claimAmount: 126000,
    ourStanding: "ARBITRATION_CLAIMANT",
    intakeDate: day(-45),
    extra: { customValues: { riskLevel: "低" } },
    parties: [
      { role: "CLIENT_PARTY", standing: "ARBITRATION_CLAIMANT", name: C.linxy.name, partyType: "NATURAL_PERSON", idNumber: C.linxy.idPlain, phone: "13585550123" },
      { role: "OPPOSING_PARTY", standing: "ARBITRATION_RESPONDENT", name: "上海晟安人力资源有限公司", partyType: "COMPANY", social: uscc("91310105MA1D5E6F7") }
    ]
  });
  const p2 = await createProcedure({
    matterId: m2.id, type: "LABOR_ARBITRATION", order: 1, status: "IN_PROGRESS", leadLawyerId: U.shen.id, caseNumber: `长劳人仲(${year})办字第1187号`,
    handlingAgency: "上海市长宁区劳动人事争议仲裁委员会", ourStanding: "ARBITRATION_CLAIMANT", acceptedAt: day(-38), currentStage: "", startedAt: day(-44),
    partyStandings: [{ partyId: m2.parties[C.linxy.name], standing: "ARBITRATION_CLAIMANT" }, { partyId: m2.parties["上海晟安人力资源有限公司"], standing: "ARBITRATION_RESPONDENT" }]
  });
  const p2StageNames = Object.keys(p2.stages);
  await prisma.matterStage.updateMany({ where: { procedureId: p2.id, order: { lte: 2 } }, data: { completedAt: day(-30) } });
  await prisma.matterStage.updateMany({ where: { procedureId: p2.id, order: { lte: 3 } }, data: { startedAt: day(-40) } });
  await prisma.deadline.create({ data: { procedureId: p2.id, title: "仲裁庭审前提交证据", category: "EVIDENCE", dueAt: day(6, 17), remindDays: 3 } });
  await prisma.hearing.create({ data: { procedureId: p2.id, title: "仲裁开庭", room: "第二仲裁庭", address: "上海市长宁区古北路 1000 号", judge: "仲裁员 蒋琳", startsAt: day(9, 14), endsAt: day(9, 16) } });
  await prisma.task.create({ data: { matterId: m2.id, stageId: p2.stages[p2StageNames[2]], title: "计算加班费与未休年假工资明细表", assigneeId: U.chen.id, dueAt: day(3, 18), priority: 1 } });
  await createDoc({ matterId: m2.id, procedureId: p2.id, name: "劳动仲裁申请书.docx", category: "PLEADING", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.shen.id, createdAt: day(-40), pages: [["申请人：林晓芸", "被申请人：上海晟安人力资源有限公司", "仲裁请求：支付违法解除劳动合同赔偿金 96,000 元、加班费 30,000 元。"]] });
  await createDoc({ matterId: m2.id, procedureId: p2.id, name: "劳动合同及解除通知.docx", category: "EVIDENCE", sourceOrigin: "CLIENT_PROVIDED", sourceParty: C.linxy.name, uploadedById: U.chen.id, createdAt: day(-44), pages: [["解除通知：因你严重违反公司规章制度，公司决定即日起解除劳动合同。"]] });
  const billing2 = await prisma.billing.create({ data: { matterId: m2.id, title: "委托代理合同 - 固定收费", contractAmount: 30000, status: "ACTIVE", signedAt: day(-45) } });
  await prisma.feeEntry.create({ data: { matterId: m2.id, billingId: billing2.id, type: "RECEIVED", amount: 15000, occurredAt: monthsAgo(1, 20), payerOrPayee: C.linxy.name, method: "微信转账", note: "首期", recordedById: U.he.id } });
  await prisma.receivable.create({ data: { matterId: m2.id, billingId: billing2.id, title: "尾款", amount: 15000, status: "OPEN", dueDate: day(20) } });
  await prisma.commissionPlan.create({ data: { matterId: m2.id, userId: U.shen.id, percent: 40, label: "主办" } });

  /* ═══════════════ M3 买卖合同纠纷（一审已结 → 二审进行中，程序链多段） ═══════════════ */
  const m3 = await createMatter({
    title: "华辰贸易（深圳）有限公司诉上海迅捷供应链管理有限公司买卖合同纠纷",
    category: "CIVIL_COMMERCIAL",
    client: C.huachen,
    ownerId: U.ye.id,
    members: [{ userId: U.lin.id, role: "CO_LEAD" }],
    cause: "买卖合同纠纷",
    claimAmount: 1260000,
    ourStanding: "PLAINTIFF",
    intakeDate: day(-230),
    extra: { customValues: { opposingFirm: "上海明理律师事务所", riskLevel: "高", courtLevel: "中级法院" } },
    parties: [
      { role: "CLIENT_PARTY", standing: "PLAINTIFF", name: C.huachen.name, partyType: "COMPANY", social: C.huachen.idPlain, legalRep: "何俊" },
      { role: "OPPOSING_PARTY", standing: "DEFENDANT", name: "上海迅捷供应链管理有限公司", partyType: "COMPANY", social: uscc("91310114MA1E7G8H9"), legalRep: "潘越" }
    ]
  });
  const p3a = await createProcedure({
    matterId: m3.id, type: "FIRST_INSTANCE", order: 1, status: "CONCLUDED", leadLawyerId: U.ye.id, caseNumber: `(${year})沪0114民初2208号`,
    handlingAgency: "上海市嘉定区人民法院", ourStanding: "PLAINTIFF", acceptedAt: day(-215), concludedAt: day(-24), outcome: "PARTIAL_WON",
    outcomeNote: "判决被告支付货款 86 万元，驳回违约金请求", currentStage: "", startedAt: day(-228),
    partyStandings: [{ partyId: m3.parties[C.huachen.name], standing: "PLAINTIFF" }, { partyId: m3.parties["上海迅捷供应链管理有限公司"], standing: "DEFENDANT" }]
  });
  await prisma.deadline.create({ data: { procedureId: p3a.id, title: "一审判决上诉期", category: "APPEAL", dueAt: day(-9, 17), basis: "判决书送达之日起十五日", sourceRuleId: await ruleId("CIVIL_APPEAL_JUDGMENT"), startFact: "判决书送达之日", completed: true, completedAt: day(-12) } });
  const p3b = await createProcedure({
    matterId: m3.id, type: "SECOND_INSTANCE", order: 2, status: "IN_PROGRESS", leadLawyerId: U.ye.id, caseNumber: `(${year})沪02民终9135号`,
    handlingAgency: "上海市第二中级人民法院", ourStanding: "APPELLANT", acceptedAt: day(-6), currentStage: "二审阅卷研判", startedAt: day(-12),
    partyStandings: [{ partyId: m3.parties[C.huachen.name], standing: "APPELLANT" }, { partyId: m3.parties["上海迅捷供应链管理有限公司"], standing: "APPELLEE" }]
  });
  await prisma.deadline.create({ data: { procedureId: p3b.id, title: "二审新证据提交期限", category: "EVIDENCE", dueAt: day(12, 17), remindDays: 7 } });
  await prisma.hearing.create({ data: { procedureId: p3b.id, title: "二审询问", room: "第十二法庭", judge: "高远", startsAt: day(16, 9, 30) } });
  await createDoc({ matterId: m3.id, procedureId: p3a.id, name: "一审民事判决书.docx", category: "JUDGMENT", sourceOrigin: "COURT_SERVED", uploadedById: U.lin.id, createdAt: day(-24), pages: [["判决如下：一、被告上海迅捷供应链管理有限公司于判决生效之日起十日内支付原告货款 860,000 元；二、驳回原告其他诉讼请求。"]] });
  await createDoc({ matterId: m3.id, procedureId: p3b.id, name: "民事上诉状.docx", category: "PLEADING", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.ye.id, createdAt: day(-12), pages: [["上诉请求：撤销一审判决第二项，改判被上诉人支付违约金 400,000 元。"]] });
  const billing3 = await prisma.billing.create({ data: { matterId: m3.id, title: "委托代理合同（一审 + 二审）", contractAmount: 200000, status: "ACTIVE", signedAt: day(-230) } });
  await prisma.feeEntry.createMany({
    data: [
      { matterId: m3.id, billingId: billing3.id, type: "RECEIVED", amount: 60000, occurredAt: monthsAgo(5, 8), invoiceNo: "44032600008812", payerOrPayee: C.huachen.name, method: "银行转账", note: "一审律师费", recordedById: U.he.id },
      { matterId: m3.id, billingId: billing3.id, type: "RECEIVED", amount: 40000, occurredAt: monthsAgo(3, 15), payerOrPayee: C.huachen.name, method: "银行转账", note: "一审阶段性付款", recordedById: U.he.id },
      { matterId: m3.id, billingId: billing3.id, type: "RECEIVABLE", amount: 100000, occurredAt: day(-95), payerOrPayee: C.huachen.name, note: "二审律师费", recordedById: U.he.id }
    ]
  });
  await prisma.receivable.create({ data: { matterId: m3.id, billingId: billing3.id, title: "二审律师费", amount: 100000, status: "OPEN", dueDate: day(-95) } });
  const inv3doc = await createDoc({ matterId: m3.id, name: "电子发票（一审律师费）.docx", category: "OTHER", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.he.id, createdAt: monthsAgo(5, 9), pages: [["发票号码 44032600008812 金额 60,000.00"]] });
  const inv3 = await prisma.invoiceRequest.create({ data: { matterId: m3.id, amount: 60000, title: "一审律师费", status: "ISSUED", invoiceType: "PLAIN", invoiceItem: "LAWYER_FEE", buyerName: C.huachen.name, buyerTaxNo: C.huachen.idPlain, invoiceNo: "44032600008812", issuedAt: monthsAgo(5, 9), requestedById: U.ye.id, requestedAt: monthsAgo(5, 5), processedById: U.he.id, processedAt: monthsAgo(5, 9), processNote: "已开具电子普票", invoiceFileId: inv3doc.id } });
  await audit(U.he.id, "INVOICE_APPROVED", "InvoiceRequest", inv3.id, monthsAgo(5, 6), { note: "合同与到账一致" });
  await audit(U.he.id, "INVOICE_ISSUED", "InvoiceRequest", inv3.id, monthsAgo(5, 9), { note: "已开具电子普票" });

  /* ═══════════════ M4 尽职调查专项（非诉 / 其他团队主办，本人协办） ═══════════════ */
  const m4 = await createMatter({
    title: "鼎晖创投拟投资杭州远帆智能科技有限公司法律尽职调查",
    category: "SPECIAL_PROJECT",
    client: C.dinghui,
    ownerId: U.lin.id,
    members: [{ userId: U.ye.id, role: "CO_LEAD" }],
    intakeDate: day(-30),
    extra: { businessType: "尽职调查", serviceScope: "目标公司主体资格、股权结构、重大合同、知识产权、诉讼仲裁与合规审查", deliverables: "法律尽职调查报告、交易文件审阅意见", serviceStart: day(-28), serviceEnd: day(20) },
    parties: [{ role: "CLIENT_PARTY", standing: "NON_LITIGATION_PARTY", name: C.dinghui.name, partyType: "COMPANY", social: C.dinghui.idPlain }]
  });
  const p4 = await createProcedure({ matterId: m4.id, type: "NON_LITIGATION_PHASE", order: 1, status: "IN_PROGRESS", leadLawyerId: U.lin.id, currentStage: "", startedAt: day(-28) });
  await prisma.matterStage.updateMany({ where: { procedureId: p4.id, order: 1 }, data: { completedAt: day(-20) } });
  await prisma.matterStage.updateMany({ where: { procedureId: p4.id, order: { lte: 2 } }, data: { startedAt: day(-25) } });
  await prisma.task.createMany({
    data: [
      { matterId: m4.id, title: "完成目标公司 23 份重大合同审阅", assigneeId: U.lin.id, dueAt: day(2, 18), priority: 1 },
      { matterId: m4.id, title: "审阅知识产权清单与专利权属证明", assigneeId: U.ye.id, dueAt: day(0, 18), priority: 2 },
      { matterId: m4.id, title: "出具尽调报告初稿", assigneeId: U.lin.id, dueAt: day(12, 18) }
    ]
  });
  const dd = await createDoc({ matterId: m4.id, procedureId: p4.id, name: "尽职调查清单（第一版）.docx", category: "OTHER", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.lin.id, createdAt: day(-26), pages: [["一、主体资格", "二、股权结构与出资", "三、目标资产抵押情况核查", "四、重大合同"]] });
  void dd;
  const billing4 = await prisma.billing.create({ data: { matterId: m4.id, title: "专项法律服务协议", contractAmount: 260000, status: "ACTIVE", signedAt: day(-30) } });
  await prisma.feeEntry.create({ data: { matterId: m4.id, billingId: billing4.id, type: "RECEIVED", amount: 130000, occurredAt: day(-5), payerOrPayee: C.dinghui.name, method: "银行转账", note: "首期 50%", recordedById: U.he.id } });
  const inv4 = await prisma.invoiceRequest.create({ data: { matterId: m4.id, amount: 130000, title: "尽调首期服务费", status: "REJECTED", invoiceType: "SPECIAL", invoiceItem: "CONSULTING_FEE", buyerName: "鼎晖创投（上海）有限公司", requestedById: U.lin.id, requestedAt: day(-4), processedById: U.he.id, processedAt: day(-3), processNote: "开票抬头与合同主体不一致，请核对后重新申请" } });
  await audit(U.he.id, "INVOICE_REJECTED", "InvoiceRequest", inv4.id, day(-3, 10), { note: "开票抬头与合同主体不一致，请核对后重新申请" });

  /* ═══════════════ M5 常年法律顾问 ═══════════════ */
  const m5 = await createMatter({
    title: `长城商业银行上海分行 ${year} 年度常年法律顾问`,
    category: "LEGAL_COUNSEL",
    client: C.bank,
    ownerId: U.ye.id,
    members: [{ userId: U.chen.id, role: "ASSISTANT" }],
    intakeDate: sh(year, 1, 5),
    extra: { counselType: "常年法律顾问", serviceScope: "合同审查、法律咨询、授信项目法律意见、员工培训（每年 2 次）", serviceStart: sh(year, 1, 1), serviceEnd: sh(year, 12, 31) },
    parties: [{ role: "CLIENT_PARTY", standing: "NON_LITIGATION_PARTY", name: C.bank.name, partyType: "COMPANY", social: C.bank.idPlain }]
  });
  const p5 = await createProcedure({ matterId: m5.id, type: "NON_LITIGATION_PHASE", order: 1, status: "IN_PROGRESS", leadLawyerId: U.ye.id, currentStage: "", startedAt: sh(year, 1, 5) });
  await prisma.matterStage.updateMany({ where: { procedureId: p5.id }, data: { startedAt: sh(year, 1, 5) } });
  await prisma.note.createMany({
    data: [
      { matterId: m5.id, authorId: U.ye.id, channel: "EMAIL", withWhom: "孙蕾", occurredAt: day(-2, 16), content: "回复分行关于经营性物业抵押贷款展期的法律意见：展期须办理抵押变更登记，否则抵押权担保范围存在争议。" },
      { matterId: m5.id, authorId: U.chen.id, channel: "WECHAT", withWhom: "孙蕾", occurredAt: day(-9, 11), content: "分行发来 3 份授信合同待审，要求本周五前反馈。" }
    ]
  });
  await prisma.task.create({ data: { matterId: m5.id, title: "审查三份授信合同并出具修改意见", assigneeId: U.ye.id, dueAt: day(0, 17), priority: 2 } });
  await createDoc({ matterId: m5.id, procedureId: p5.id, name: "关于抵押贷款展期的法律意见书.docx", category: "OTHER", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.ye.id, createdAt: day(-2), pages: [["经审查，贷款展期未办理抵押变更登记的，抵押权人主张就展期后的债务优先受偿存在不被支持的风险……"]] });
  const billing5 = await prisma.billing.create({ data: { matterId: m5.id, title: `${year} 年度顾问合同`, contractAmount: 240000, schedule: "按季度支付 60,000", status: "ACTIVE", signedAt: sh(year, 1, 5) } });
  for (const [i, mAgo] of [5, 2].entries()) {
    await prisma.feeEntry.create({ data: { matterId: m5.id, billingId: billing5.id, type: "RECEIVED", amount: 60000, occurredAt: monthsAgo(mAgo, 12), invoiceNo: `3100260000${5566 + i}`, payerOrPayee: C.bank.name, method: "银行转账", note: `第 ${i + 1} 季度顾问费`, recordedById: U.he.id } });
  }
  await prisma.feeEntry.create({ data: { matterId: m5.id, billingId: billing5.id, type: "COMMISSION", amount: 18000, occurredAt: day(-1), beneficiaryUserId: U.ye.id, note: "本月顾问费分成", recordedById: U.he.id } });
  await prisma.receivable.create({ data: { matterId: m5.id, billingId: billing5.id, title: "第三季度顾问费", amount: 60000, status: "OPEN", dueDate: day(-15) } });
  const inv5 = await prisma.invoiceRequest.create({ data: { matterId: m5.id, amount: 60000, title: "第三季度顾问费", status: "APPROVED", invoiceType: "SPECIAL", invoiceItem: "LAWYER_FEE", buyerName: C.bank.name, buyerTaxNo: C.bank.idPlain, buyerAddress: "上海市浦东新区陆家嘴环路 1000 号", buyerPhone: "021-50000000", buyerBank: "长城商业银行上海分行营业部", buyerBankAccount: "310000000000009", requestedById: U.ye.id, requestedAt: day(-3), processedById: U.zhou.id, processedAt: day(-2), processNote: "同意开具" } });
  await audit(U.zhou.id, "INVOICE_APPROVED", "InvoiceRequest", inv5.id, day(-2, 10), { note: "同意开具" });

  /* ═══════════════ M6 刑事辩护（受限事项） ═══════════════ */
  const m6 = await createMatter({
    title: "张伟涉嫌合同诈骗罪审查起诉阶段辩护",
    category: "CRIMINAL",
    client: C.zhangwei,
    ownerId: U.ye.id,
    members: [{ userId: U.chen.id, role: "ASSISTANT" }],
    cause: "合同诈骗罪",
    intakeDate: day(-35),
    teamAccessRestricted: true,
    ourStanding: "CRIMINAL_DEFENDANT",
    parties: [{ role: "CLIENT_PARTY", standing: "CRIMINAL_DEFENDANT", name: C.zhangwei.name, partyType: "NATURAL_PERSON", idNumber: C.zhangwei.idPlain }]
  });
  const p6 = await createProcedure({ matterId: m6.id, type: "PROSECUTION_REVIEW", order: 1, status: "IN_PROGRESS", leadLawyerId: U.ye.id, handlingAgency: "苏州市姑苏区人民检察院", caseNumber: `苏姑检刑诉受(${year})218号`, ourStanding: "CRIMINAL_DEFENDANT", acceptedAt: day(-20), currentStage: "", startedAt: day(-33) });
  await prisma.matterStage.updateMany({ where: { procedureId: p6.id, order: { lte: 2 } }, data: { startedAt: day(-30) } });
  await prisma.matterStage.updateMany({ where: { procedureId: p6.id, order: 1 }, data: { completedAt: day(-25) } });
  await prisma.deadline.create({ data: { procedureId: p6.id, title: "审查起诉期限届满（一个月）", category: "CUSTOM", dueAt: day(10, 17), basis: "《刑事诉讼法》第一百七十二条", remindDays: 7 } });
  await prisma.task.createMany({ data: [{ matterId: m6.id, title: "看守所会见（第三次）", assigneeId: U.ye.id, dueAt: day(2, 10), priority: 2 }, { matterId: m6.id, title: "提交不起诉法律意见书", assigneeId: U.ye.id, dueAt: day(7, 18), priority: 1 }] });
  await createDoc({ matterId: m6.id, procedureId: p6.id, name: "起诉意见书（阅卷摘录）.docx", category: "PROCEDURE", sourceOrigin: "SELF_COLLECTED", uploadedById: U.chen.id, createdAt: day(-18), pages: [["犯罪嫌疑人张伟以虚构工程项目为由，与被害单位签订合同骗取保证金 86 万元……"]] });
  await prisma.note.create({ data: { matterId: m6.id, authorId: U.ye.id, channel: "MEETING", withWhom: "张伟（看守所会见）", occurredAt: day(-8, 10), content: "研判：保证金已部分用于项目前期费用，主观非法占有目的证据不足，拟提出不起诉意见。", tags: ["研判笔记"] } });
  await prisma.billing.create({ data: { matterId: m6.id, title: "刑事辩护委托协议", contractAmount: 150000, status: "ACTIVE", signedAt: day(-35) } });
  await prisma.feeEntry.create({ data: { matterId: m6.id, type: "RECEIVED", amount: 150000, occurredAt: monthsAgo(1, 3), payerOrPayee: "李娜（家属）", method: "银行转账", note: "一次性支付", recordedById: U.he.id } });

  /* ═══════════════ M7 行政诉讼（暂停） ═══════════════ */
  const m7 = await createMatter({
    title: "恒丰置业（苏州）有限公司诉苏州市虎丘区市场监督管理局行政处罚",
    category: "ADMINISTRATIVE",
    status: "ON_HOLD",
    client: C.hengfeng,
    ownerId: U.lin.id,
    members: [{ userId: U.ye.id, role: "CO_LEAD" }],
    intakeDate: day(-120),
    causeFreeText: "行政处罚（广告违法）",
    ourStanding: "ADMIN_PLAINTIFF",
    parties: [
      { role: "CLIENT_PARTY", standing: "ADMIN_PLAINTIFF", name: C.hengfeng.name, partyType: "COMPANY", social: C.hengfeng.idPlain },
      { role: "OPPOSING_PARTY", standing: "ADMIN_DEFENDANT", name: "苏州市虎丘区市场监督管理局", partyType: "GOVERNMENT" }
    ]
  });
  const p7 = await createProcedure({ matterId: m7.id, type: "ADMIN_RECONSIDERATION", order: 1, status: "IN_PROGRESS", leadLawyerId: U.lin.id, handlingAgency: "苏州市虎丘区人民政府", currentStage: "", startedAt: day(-115) });
  await prisma.procedureMemo.create({ data: { procedureId: p7.id, content: "复议机关已中止审查，等待关联刑事案件结论后恢复；暂停期间每月跟进一次。", createdById: U.lin.id } });
  await prisma.timelineEvent.create({ data: { matterId: m7.id, eventType: "STATUS_CHANGED", title: "案件状态改为「暂停」", content: "复议中止审查", occurredAt: day(-50) } });

  /* ═══════════════ M8 已结案待归档（归档审批） ═══════════════ */
  const m8 = await createMatter({
    title: "盛通物流有限公司诉宏达电子（昆山）有限公司运输合同纠纷",
    category: "CIVIL_COMMERCIAL",
    status: "CLOSED",
    client: C.shengtong,
    ownerId: U.shen.id,
    members: [{ userId: U.ye.id, role: "CO_LEAD" }],
    cause: "运输合同纠纷",
    claimAmount: 386000,
    ourStanding: "PLAINTIFF",
    intakeDate: day(-210),
    closedAt: day(-35),
    parties: [
      { role: "CLIENT_PARTY", standing: "PLAINTIFF", name: C.shengtong.name, partyType: "COMPANY", social: C.shengtong.idPlain },
      { role: "OPPOSING_PARTY", standing: "DEFENDANT", name: "宏达电子（昆山）有限公司", partyType: "COMPANY", social: uscc("91320583MA1R2S3T4") }
    ]
  });
  const p8 = await createProcedure({ matterId: m8.id, type: "FIRST_INSTANCE", order: 1, status: "CONCLUDED", leadLawyerId: U.shen.id, caseNumber: `(${year})沪0112民初1560号`, handlingAgency: "上海市闵行区人民法院", acceptedAt: day(-190), concludedAt: day(-40), outcome: "MEDIATED", outcomeNote: "调解结案，被告分两期支付 36 万元", currentStage: "", startedAt: day(-205) });
  const m8Docs = [
    await createDoc({ matterId: m8.id, procedureId: p8.id, name: "委托代理合同（盛通物流）.docx", category: "CONTRACT", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.shen.id, createdAt: day(-208), archiveChecklistItemId: "retainer_contract", pages: [["委托人：盛通物流有限公司", "代理费：固定 45,000 元"]] }),
    await createDoc({ matterId: m8.id, procedureId: p8.id, name: "授权委托书（盛通物流）.docx", category: "PROCEDURE", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.shen.id, createdAt: day(-208), archiveChecklistItemId: "power_of_attorney", pages: [["受托人：沈青、叶森"]] }),
    await createDoc({ matterId: m8.id, procedureId: p8.id, name: "民事起诉状（运输合同）.docx", category: "PLEADING", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.shen.id, createdAt: day(-195), archiveChecklistItemId: "pleading", pages: [["诉讼请求：判令被告支付运费 386,000 元。"]] }),
    await createDoc({ matterId: m8.id, procedureId: p8.id, name: "证据目录及证据.docx", category: "EVIDENCE", sourceOrigin: "CLIENT_PROVIDED", uploadedById: U.shen.id, createdAt: day(-190), archiveChecklistItemId: "evidence_catalog", pages: [["1. 运输合同", "2. 签收单 46 份", "3. 对账单"]] }),
    await createDoc({ matterId: m8.id, procedureId: p8.id, name: "民事调解书.docx", category: "JUDGMENT", sourceOrigin: "COURT_SERVED", uploadedById: U.shen.id, createdAt: day(-40), archiveChecklistItemId: "judgment", pages: [["经本院主持调解，双方自愿达成协议：被告分两期支付原告运费 360,000 元。"]] })
  ];
  await prisma.feeEntry.create({ data: { matterId: m8.id, type: "RECEIVED", amount: 45000, occurredAt: monthsAgo(4, 18), invoiceNo: "31002600007788", payerOrPayee: C.shengtong.name, method: "银行转账", recordedById: U.he.id } });
  const checklist = checklistForCategory("CIVIL_COMMERCIAL");
  const byItem = new Map(m8Docs.map((d) => [d.archiveChecklistItemId, d.id]));
  const archive8 = await prisma.archiveRecord.create({
    data: {
      matterId: m8.id,
      archiveNo: `${year}-民-0001`,
      summary: "本案经闵行法院主持调解结案，被告已按期履行第一期 18 万元，第二期约定于下月支付。",
      judgmentSummary: "民事调解书：被告分两期支付运费 36 万元。",
      closedReason: "MEDIATION",
      completedAt: day(-40),
      checklistJson: {
        schemaVersion: ARCHIVE_SNAPSHOT_VERSION,
        policy: { configured: true, name: "律师事务所业务档案管理办法", version: `${year} 版`, effectiveAt: `${year}-01-01`, sourceFileId: policyFile.id, sourceFileName: policyFile.name, sourceFileSha256: policyFile.sha },
        checklist: {
          kind: checklist.kind,
          title: checklist.title,
          items: checklist.items.map((it) => {
            const docId = byItem.get(it.id);
            return { id: it.id, label: it.label, required: it.required, autoGenerated: Boolean(it.autoGenerated), status: docId ? "ATTACHED" : it.required ? "MISSING" : "NOT_APPLICABLE", note: docId ? "" : it.required ? "客户尚未寄回原件" : "", documentIds: docId ? [docId] : [] };
          })
        },
        manualChecks: ARCHIVE_MANUAL_CHECKS.map((c) => ({ id: c.id, label: c.label, confirmed: c.id !== "originals_handled", note: c.id === "originals_handled" ? "第二期款项到账后退还原件" : "" })),
        documents: m8Docs.map((d, i) => ({ id: d.id, name: d.name, category: d.category, workflowStatus: d.status, version: 1, isLatest: true, folderName: null, mimeType: DOCX_MIME, size: d.size ?? 0, sha256: d.sha256 ?? "", checklistItemIds: d.archiveChecklistItemId ? [d.archiveChecklistItemId] : [], order: i + 1 })),
        excludedDocuments: [],
        documentIds: m8Docs.map((d) => d.id),
        submittedAt: day(-2, 15).toISOString(),
        previousRecordId: null
      } as Prisma.InputJsonValue,
      missingItems: checklist.items.filter((it) => it.required && !byItem.has(it.id)).map((it) => it.label),
      archivedBy: U.shen.name,
      archivedById: U.shen.id,
      archivedAt: day(-2, 15),
      status: "PENDING_REVIEW"
    }
  });
  void archive8;

  /* ═══════════════ M9 已归档（去年） ═══════════════ */
  const lastYear = year - 1;
  const m9 = await createMatter({
    title: "陈明与刘婷离婚纠纷",
    category: "CIVIL_COMMERCIAL",
    status: "ARCHIVED",
    serviceStatus: "SERVICE_COMPLETED",
    client: C.chenming,
    ownerId: U.ye.id,
    cause: "离婚纠纷",
    ourStanding: "PLAINTIFF",
    intakeDate: sh(lastYear, 3, 6),
    closedAt: sh(lastYear, 11, 12),
    archivedAt: sh(lastYear, 12, 2),
    parties: [
      { role: "CLIENT_PARTY", standing: "PLAINTIFF", name: C.chenming.name, partyType: "NATURAL_PERSON", idNumber: C.chenming.idPlain },
      { role: "OPPOSING_PARTY", standing: "DEFENDANT", name: "刘婷", partyType: "NATURAL_PERSON", idNumber: idCard("31010419830506142") }
    ]
  });
  await createProcedure({ matterId: m9.id, type: "FIRST_INSTANCE", order: 1, status: "CONCLUDED", leadLawyerId: U.ye.id, caseNumber: `(${lastYear})沪0104民初3321号`, handlingAgency: "上海市徐汇区人民法院", concludedAt: sh(lastYear, 11, 12), outcome: "WON", outcomeNote: "准予离婚，房产按约定分割", currentStage: "", startedAt: sh(lastYear, 3, 8) });
  await prisma.archiveRecord.create({ data: { matterId: m9.id, archiveNo: `${lastYear}-民-0012`, summary: "判决准予离婚，财产分割请求获支持。", closedReason: "JUDGMENT", completedAt: sh(lastYear, 11, 12), checklistJson: {}, missingItems: [], archivedBy: U.ye.name, archivedById: U.ye.id, archivedAt: sh(lastYear, 12, 1), status: "APPROVED", reviewedById: U.zhou.id, reviewedAt: sh(lastYear, 12, 2), reviewNote: "材料齐全，同意归档" } });

  /* ═══════════════ 收案：待审批 / 待补正 / 不接案 / 草稿 / 已转案件待受理 ═══════════════ */
  const intakeA = await prisma.intake.create({
    data: {
      title: "远航科技（杭州）有限公司诉华东置业有限公司股权转让纠纷",
      category: "CIVIL_COMMERCIAL",
      causeId: await causeId("CIVIL_COMMERCIAL", "股权转让纠纷"),
      description: "远航科技受让华东置业子公司 30% 股权后，发现对方隐瞒对外担保，拟起诉解除合同并返还转让款 1,200 万元。",
      status: "PENDING_CONFIRMATION",
      receivedAt: day(-1, 14),
      clientId: C.yuanhang.id, clientType: "COMPANY", contactName: "钱锋", contactPhone: "13588120077",
      firstProcedureType: "FIRST_INSTANCE", firstAgency: "上海市徐汇区人民法院", jurisdiction: "上海市/徐汇区", ourStanding: "PLAINTIFF", claimAmount: 12000000, barFiling: "MAJOR",
      feeType: "CONTINGENCY", feeAmount: 200000, contingencyTerms: "基础费 20 万元，另按实际回收金额 6% 计收", ownerUserId: U.lin.id, coUserIds: [U.shen.id], createdById: U.lin.id,
      parties: { create: [{ role: "OPPOSING_PARTY", standing: "DEFENDANT", name: "华东置业有限公司", partyType: "COMPANY", enterpriseSocialCode: uscc("91310105MA1B2C3D4"), legalRep: "陆志远" }] }
    }
  });
  await createDoc({ intakeId: intakeA.id, name: "股权转让协议.docx", category: "CONTRACT", sourceOrigin: "CLIENT_PROVIDED", uploadedById: U.lin.id, createdAt: day(-1), pages: [["转让方：华东置业有限公司", "受让方：远航科技（杭州）有限公司", "转让价款：人民币 12,000,000 元"]] });
  await conflictCheckFor(intakeA.id, [{ role: "CLIENT_PARTY", name: C.yuanhang.name, idNumber: C.yuanhang.idPlain }, { role: "OPPOSING_PARTY", name: "华东置业有限公司" }], U.lin.id, day(-1, 14, 20));
  await audit(U.lin.id, "INTAKE_RESUBMIT", "Intake", intakeA.id, day(-1, 14, 30), { note: "提交收案审批" });

  const intakeB = await prisma.intake.create({
    data: {
      title: "王芳与李强离婚纠纷",
      category: "CIVIL_COMMERCIAL",
      causeId: await causeId("CIVIL_COMMERCIAL", "离婚纠纷"),
      description: "双方婚后购置房产一套，就子女抚养权与房产分割存在争议。",
      status: "PENDING_CONFIRMATION",
      receivedAt: day(-3, 10),
      clientId: C.wangfang.id, clientType: "INDIVIDUAL", contactPhone: "13601770321",
      firstProcedureType: "FIRST_INSTANCE", firstAgency: "上海市杨浦区人民法院", ourStanding: "PLAINTIFF", barFiling: "NONE",
      feeType: "FIXED", feeAmount: 50000, ownerUserId: U.shen.id, createdById: U.shen.id,
      parties: { create: [{ role: "OPPOSING_PARTY", standing: "DEFENDANT", name: "李强", partyType: "NATURAL_PERSON", idNumber: idCard("31011019860302311") }] }
    }
  });
  await conflictCheckFor(intakeB.id, [{ role: "CLIENT_PARTY", name: C.wangfang.name, idNumber: C.wangfang.idPlain }, { role: "OPPOSING_PARTY", name: "李强" }], U.shen.id, day(-3, 10, 30));
  await audit(U.shen.id, "INTAKE_RESUBMIT", "Intake", intakeB.id, day(-3, 10, 40), { note: "提交收案审批" });

  const intakeC = await prisma.intake.create({
    data: {
      title: "众诚餐饮管理有限公司与上海静安嘉里商业管理有限公司房屋租赁合同纠纷",
      category: "CIVIL_COMMERCIAL",
      causeId: await causeId("CIVIL_COMMERCIAL", "房屋租赁合同纠纷"),
      description: "商场以欠付租金为由封闭店铺，客户主张商场提前停止空调供应构成违约。",
      status: "NEEDS_REVISION",
      receivedAt: day(-9),
      clientId: C.zhongcheng.id, clientType: "COMPANY",
      firstProcedureType: "FIRST_INSTANCE", ourStanding: "DEFENDANT", feeType: "FIXED", feeAmount: 60000,
      ownerUserId: U.shen.id, createdById: U.shen.id,
      parties: { create: [{ role: "OPPOSING_PARTY", standing: "PLAINTIFF", name: "上海静安嘉里商业管理有限公司", partyType: "COMPANY" }] }
    }
  });
  await conflictCheckFor(intakeC.id, [{ role: "CLIENT_PARTY", name: C.zhongcheng.name }, { role: "OPPOSING_PARTY", name: "上海静安嘉里商业管理有限公司" }], U.shen.id, day(-9, 11));
  await audit(U.shen.id, "INTAKE_RESUBMIT", "Intake", intakeC.id, day(-9, 11, 10), { note: "提交收案审批" });
  await audit(U.zhou.id, "INTAKE_NEEDS_REVISION", "Intake", intakeC.id, day(-8, 16), { note: "请补充租赁合同原件、欠费对账单及对方商场的统一社会信用代码后重新提交" });

  const intakeD = await prisma.intake.create({
    data: {
      title: "华东置业有限公司应诉上海青石建设有限公司工程款纠纷",
      category: "CIVIL_COMMERCIAL",
      status: "DECLINED",
      declinedReason: "利益冲突：本所正代理上海青石建设有限公司起诉华东置业有限公司（同一纠纷），依《律师执业行为规范》不得接受对方委托。",
      receivedAt: day(-20),
      clientType: "COMPANY", contactName: "陆志远",
      firstProcedureType: "FIRST_INSTANCE", ourStanding: "DEFENDANT", ownerUserId: U.lin.id, createdById: U.lin.id,
      parties: {
        create: [
          { role: "CLIENT_PARTY", standing: "DEFENDANT", name: "华东置业有限公司", partyType: "COMPANY", enterpriseSocialCode: uscc("91310105MA1B2C3D4") },
          { role: "OPPOSING_PARTY", standing: "PLAINTIFF", name: C.qingshi.name, partyType: "COMPANY", enterpriseSocialCode: C.qingshi.idPlain }
        ]
      }
    }
  });
  await conflictCheckFor(intakeD.id, [{ role: "CLIENT_PARTY", name: "华东置业有限公司" }, { role: "OPPOSING_PARTY", name: C.qingshi.name, idNumber: C.qingshi.idPlain }], U.lin.id, day(-20, 10), { value: "SAME_SUBJECT", note: "命中本所在办案件 LL 编号对应的对方当事人，构成直接利益冲突。" });
  await audit(U.zhou.id, "INTAKE_DECLINE", "Intake", intakeD.id, day(-19, 9), { note: "存在直接利益冲突，不予接案" });

  await prisma.intake.create({
    data: {
      title: "（草稿）众鑫机械设备租赁合同咨询",
      category: "CIVIL_COMMERCIAL",
      status: "INTAKE",
      description: "客户电话咨询设备租赁押金返还，尚未确定是否委托。",
      receivedAt: day(0, 9),
      ownerUserId: U.ye.id,
      createdById: U.ye.id
    }
  });

  const intakeE = await prisma.intake.create({
    data: {
      title: "上海青石建设有限公司与江苏宏建劳务有限公司劳务分包合同纠纷",
      category: "COMMERCIAL_ARBITRATION",
      description: "劳务分包合同约定上海仲裁委员会仲裁，对方主张劳务费 210 万元，我方为被申请人。",
      status: "CONVERTED",
      receivedAt: day(-4),
      clientId: C.qingshi.id, clientType: "COMPANY", firstProcedureType: "COMMERCIAL_ARBITRATION", firstAgency: "上海仲裁委员会", ourStanding: "ARBITRATION_RESPONDENT", claimAmount: 2100000,
      feeType: "FIXED", feeAmount: 120000, ownerUserId: U.ye.id, createdById: U.ye.id,
      parties: { create: [{ role: "OPPOSING_PARTY", standing: "ARBITRATION_CLAIMANT", name: "江苏宏建劳务有限公司", partyType: "COMPANY" }] }
    }
  });
  await audit(U.zhou.id, "INTAKE_CONVERT", "Intake", intakeE.id, day(-2, 17), { note: "同意收案" });
  const m10 = await createMatter({
    title: "上海青石建设有限公司与江苏宏建劳务有限公司劳务分包合同纠纷",
    category: "COMMERCIAL_ARBITRATION",
    status: "PENDING_ACCEPTANCE",
    client: C.qingshi,
    ownerId: U.ye.id,
    cause: "建设工程分包合同纠纷",
    claimAmount: 2100000,
    ourStanding: "ARBITRATION_RESPONDENT",
    intakeDate: day(-2),
    intakeId: intakeE.id,
    parties: [
      { role: "CLIENT_PARTY", standing: "ARBITRATION_RESPONDENT", name: C.qingshi.name, partyType: "COMPANY", social: C.qingshi.idPlain },
      { role: "OPPOSING_PARTY", standing: "ARBITRATION_CLAIMANT", name: "江苏宏建劳务有限公司", partyType: "COMPANY" }
    ]
  });
  await createProcedure({ matterId: m10.id, type: "COMMERCIAL_ARBITRATION", order: 1, status: "PENDING", leadLawyerId: U.ye.id, handlingAgency: "上海仲裁委员会", ourStanding: "ARBITRATION_RESPONDENT", currentStage: "", startedAt: day(-2) });
  await prisma.billing.create({ data: { matterId: m10.id, title: "委托代理合同 - 固定收费", contractAmount: 120000, status: "DRAFT" } });
  await prisma.matterLink.create({ data: { matterId: m10.id, relatedMatterId: m1.id, relation: "RELATED_CONTRACT", notedById: U.ye.id } });
  await prisma.engagementMatter.create({ data: { engagementId: engagementQ.id, matterId: m10.id, validFrom: day(-2) } });

  /* ── 独立冲突检索（冲突检索页「既往检索记录」） ── */
  await conflictCheckFor(null, [{ role: "OPPOSING_PARTY", name: "上海迅捷供应链管理有限公司" }], U.ye.id, day(-5, 15));
  await conflictCheckFor(null, [{ role: "CLIENT_PARTY", name: "长城商业银行股份有限公司上海分行" }, { role: "OPPOSING_PARTY", name: "华东置业有限公司" }], U.ye.id, day(-1, 9, 30));

  /* ── 用章申请：待审批 / 已批待盖章 / 已盖章 / 驳回 ── */
  const purposes = await prisma.sealPurposeConfig.findMany({ select: { id: true, name: true } });
  const purpose = (kw: string) => purposes.find((p) => p.name.includes(kw)) ?? purposes[0];
  const sealCode = async () => `SEAL-${year}-${String(await nextSystemCounter(`seal-counter-${year}`)).padStart(4, "0")}`;
  const s1 = await prisma.sealRequest.create({ data: { code: await sealCode(), sealType: "OFFICIAL_SEAL", matterId: m1.id, purposeConfigId: purpose("律师函").id, purposeLabel: purpose("律师函").name, purpose: "向华东置业发送催告履行律师函", documentTitle: "律师函（致华东置业有限公司·催告履行）", pageCount: 2, copies: 2, urgency: "URGENT", draftDocId: d1.lawyerLetter.id, requestNote: "开庭前需寄出，今日内请审批", requestedById: U.shen.id, requestedAt: day(0, 9, 20) } });
  void s1;
  const s2draft = await createDoc({ matterId: m4.id, name: "法律服务方案（远帆智能尽调补充）.docx", category: "OTHER", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.lin.id, createdAt: day(-2), pages: [["补充尽调范围：数据合规与出口管制"]] });
  const s2 = await prisma.sealRequest.create({ data: { code: await sealCode(), sealType: "CONTRACT_SEAL", matterId: m4.id, purposeConfigId: purpose("报价函").id, purposeLabel: purpose("报价函").name, purpose: "补充服务方案盖章后发送客户", documentTitle: "法律服务方案（远帆智能尽调补充）", pageCount: 4, copies: 1, draftDocId: s2draft.id, requestedById: U.lin.id, requestedAt: day(-2, 10), status: "APPROVED", approvedById: U.zhou.id, approvedAt: day(-1, 11), approveNote: "同意" } });
  await audit(U.zhou.id, "SEAL_APPROVED", "SealRequest", s2.id, day(-1, 11), { note: "同意" });
  const s3draft = await createDoc({ matterId: m2.id, name: "授权委托书（林晓芸）.docx", category: "PROCEDURE", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.shen.id, createdAt: day(-43), pages: [["委托人：林晓芸", "受托人：沈青"]] });
  const s3stamped = await createDoc({ matterId: m2.id, name: "授权委托书（林晓芸·盖章扫描件）.docx", category: "PROCEDURE", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.wang.id, createdAt: day(-42), pages: [["（已加盖律所公章）"]] });
  const s3 = await prisma.sealRequest.create({ data: { code: await sealCode(), sealType: "OFFICIAL_SEAL", matterId: m2.id, purposeConfigId: purpose("委托").id, purposeLabel: purpose("委托").name, purpose: "仲裁立案所需授权委托书", documentTitle: "授权委托书（林晓芸）", draftDocId: s3draft.id, stampedDocId: s3stamped.id, requestedById: U.shen.id, requestedAt: day(-43, 9), status: "STAMPED", approvedById: U.ye.id, approvedAt: day(-43, 11), stampedById: U.wang.id, stampedAt: day(-42, 10) } });
  await audit(U.ye.id, "SEAL_APPROVED", "SealRequest", s3.id, day(-43, 11), { note: "同意" });
  await audit(U.wang.id, "SEAL_STAMPED", "SealRequest", s3.id, day(-42, 10), { note: "已盖章并回填扫描件" });
  const s4draft = await createDoc({ name: "办公设备采购合同.docx", category: "CONTRACT", sourceOrigin: "TEAM_PRODUCED", uploadedById: U.wang.id, createdAt: day(-6), pages: [["采购内容：打印复印一体机 2 台"]] });
  const s4 = await prisma.sealRequest.create({ data: { code: await sealCode(), sealType: "FINANCE_SEAL", purposeConfigId: purpose("内部行政").id, purposeLabel: purpose("内部行政").name, purpose: "行政采购合同盖章", documentTitle: "办公设备采购合同", draftDocId: s4draft.id, requestedById: U.wang.id, requestedAt: day(-6, 14), status: "REJECTED", rejectedAt: day(-5, 10), approvedById: U.zhou.id, approveNote: "采购合同应加盖合同专用章，请重新申请" } });
  await audit(U.zhou.id, "SEAL_REJECTED", "SealRequest", s4.id, day(-5, 10), { note: "采购合同应加盖合同专用章，请重新申请" });

  /* ── 法院短信 ── */
  const smsSpecs = [
    { text: `【上海市长宁区人民法院】叶森律师：您代理的(${year})沪0105民初4421号上海青石建设有限公司与华东置业有限公司建设工程施工合同纠纷一案，定于${day(5).getMonth() + 1}月${day(5).getDate()}日09时30分在第七法庭开庭，请准时到庭。`, matter: m1.id, type: "HEARING_NOTICE" as const, processed: false, manual: false, at: day(-1, 16) },
    { text: `【上海市第二中级人民法院】您好，(${year})沪02民终9135号案件的传票、举证通知书已通过电子送达，请登录 https://zxfw.court.gov.cn 查收，验证码 482913。`, matter: m3.id, type: "SERVICE_NOTICE" as const, processed: false, manual: true, at: day(-2, 11) },
    { text: `【上海市嘉定区人民法院】(${year})沪0114民初2208号案件判决书已送达，上诉期十五日。`, matter: m3.id, type: "JUDGMENT_NOTICE" as const, processed: true, manual: false, at: day(-24, 9) },
    { text: "【12368】您好，您有一条缴费通知：案件受理费 23,870 元，请于七日内缴纳。", matter: null, type: "FEE_NOTICE" as const, processed: false, manual: false, at: day(-3, 10) }
  ];
  for (const s of smsSpecs) {
    await prisma.smsMessage.create({
      data: {
        rawText: s.text, receivedAt: s.at, receivedById: U.ye.id, parsedJson: parseSms(s.text) as unknown as Prisma.InputJsonValue, smsType: s.type,
        matchedMatterId: s.matter, matchedBy: s.matter ? "AUTO_CASE_NUMBER" : "UNMATCHED", processed: s.processed, processedAt: s.processed ? day(-23) : null, needsManualAction: s.manual
      }
    });
  }

  /* ── 财务：近半年收入与跨期应收（报表与账龄） ── */
  await prisma.feeEntry.createMany({
    data: [
      { matterId: m8.id, type: "RECEIVED", amount: 28000, occurredAt: monthsAgo(0, 2), payerOrPayee: C.shengtong.name, method: "银行转账", note: "调解后支付的剩余律师费", recordedById: U.he.id },
      { matterId: m4.id, type: "COST", amount: 3600, occurredAt: day(-7), payerOrPayee: "国家企业信用信息查询服务", method: "公司卡", note: "工商档案调取费", recordedById: U.lin.id }
    ]
  });
  await prisma.receivable.create({ data: { matterId: m8.id, title: "差旅费报销（客户承担）", amount: 6800, status: "OPEN", dueDate: day(-72) } });

  /* ── 公告 / 外部联系人 ── */
  await prisma.announcement.createMany({
    data: [
      { title: `${year} 年第三季度结案归档专项检查`, content: "请各团队于本月 30 日前完成已结案超过 30 日案件的归档申请；逾期未归档案件将在周报中列示。", pinned: true, publishedAt: day(-3), expiresAt: day(14), authorId: U.zhou.id },
      { title: "关于启用利益冲突审查新流程的通知", content: "自本月起，所有收案须在提交审批前完成冲突检索；命中阻塞级冲突的收案不得提交。", pinned: false, publishedAt: day(-20), authorId: U.zhou.id },
      { title: "国庆假期值班安排", content: "10 月 1 日至 7 日由叶森团队、周岚团队轮值，紧急用章联系王璐。", pinned: false, publishedAt: day(-1), authorId: U.wang.id },
      { title: "（已归档）2025 年度考核说明", content: "考核结果已发放。", pinned: false, publishedAt: day(-240), archivedAt: day(-200), authorId: U.zhou.id }
    ]
  });
  await prisma.externalContact.createMany({
    data: [
      { name: "周立", category: "COURT", organization: "上海市长宁区人民法院 民一庭", title: "法官助理", phone: "021-52110000-2231", notes: "4421 号案件承办助理", createdById: U.chen.id, reviewedById: U.ye.id, reviewedAt: day(-50) },
      { name: "蒋琳", category: "ARBITRATION", organization: "上海市长宁区劳动人事争议仲裁委员会", title: "仲裁员", phone: "021-62590000", createdById: U.shen.id, reviewedById: U.ye.id, reviewedAt: day(-30) },
      { name: "唐慧", category: "NOTARY", organization: "上海市东方公证处", title: "公证员", phone: "13761230045", email: "tanghui@notary-demo.cn", createdById: U.wang.id, reviewedById: U.zhou.id, reviewedAt: day(-90) },
      { name: "赵磊", category: "OTHER_FIRM", organization: "上海衡正律师事务所", title: "合伙人", phone: "13918860077", notes: "华东置业代理律师", createdById: U.shen.id, reviewedById: U.ye.id, reviewedAt: day(-40) },
      { name: "孔祥", category: "EXPERT", organization: "上海建科工程造价咨询有限公司", title: "注册造价工程师", phone: "13817765500", notes: "鉴定机构候选，报价待确认", status: "PENDING_REVIEW", createdById: U.chen.id, createdAt: day(-2) },
      { name: "马骏", category: "PROSECUTOR", organization: "苏州市姑苏区人民检察院", title: "检察官助理", phone: "0512-65220000", createdById: U.ye.id, reviewedById: U.zhou.id, reviewedAt: day(-18) }
    ]
  });

  /* ── 通知（当前管理员与演示账号） ── */
  const notify = (userId: string, n: Omit<Prisma.NotificationUncheckedCreateInput, "userId">) => prisma.notification.create({ data: { userId, ...n } });
  await notify(U.ye.id, { type: "DEADLINE_REMINDER", priority: "URGENT", title: "期限已逾期：提交工程造价鉴定申请", content: `${m1.internalCode} · 已逾期 1 天`, href: `/matters/${m1.id}`, createdAt: day(0, 9) });
  await notify(U.ye.id, { type: "HEARING_REMINDER", priority: "HIGH", title: "开庭提醒：5 天后第一次庭审", content: "长宁法院第七法庭 09:30", href: `/matters/${m1.id}`, createdAt: day(0, 9) });
  await notify(U.ye.id, { type: "SEAL_STATUS_CHANGE", title: "沈青提交了用章申请（加急）", content: "律师函（致华东置业有限公司·催告履行）", href: "/approvals", createdAt: day(0, 9, 21) });
  await notify(U.ye.id, { type: "SMS_ARRIVAL", title: "新法院短信：开庭通知", content: `(${year})沪0105民初4421号`, href: "/inbox", createdAt: day(-1, 16) });
  await notify(U.ye.id, { type: "PRESERVATION_EXPIRY", priority: "HIGH", title: "保全即将到期：华东置业银行存款冻结", content: "18 天后到期，请安排续封", href: "/preservation", createdAt: day(-1, 9) });
  await notify(U.ye.id, { type: "TASK_ASSIGNED", title: "林默给你分配了任务", content: "审阅知识产权清单与专利权属证明", href: `/matters/${m4.id}`, read: true, readAt: day(-3), createdAt: day(-4) });
  await notify(U.ye.id, { type: "SYSTEM", title: "归档申请待审批：盛通物流运输合同纠纷", content: "沈青提交 · 缺 1 项必交材料", href: "/approvals", createdAt: day(-2, 15) });
  await notify(U.ye.id, { type: "ARCHIVE_APPROVED", title: "归档已通过：陈明与刘婷离婚纠纷", read: true, readAt: sh(lastYear, 12, 3), createdAt: sh(lastYear, 12, 2) });
  await notify(U.shen.id, { type: "SYSTEM", title: "收案退回补正：众诚餐饮房屋租赁合同纠纷", content: "请补充租赁合同原件、欠费对账单", href: `/intakes/${intakeC.id}`, createdAt: day(-8, 16) });
  await notify(U.he.id, { type: "SYSTEM", title: "新的开票申请：第二期律师费 120,000 元", href: "/approvals", createdAt: day(-1, 16) });

  /* ── 时间线补充 ── */
  await prisma.timelineEvent.createMany({
    data: [
      { matterId: m1.id, eventType: "PROCEDURE_ACCEPTED", title: "一审立案受理", content: p1.caseNumber, occurredAt: day(-60) },
      { matterId: m1.id, eventType: "PRESERVATION", title: "诉讼保全裁定：冻结银行存款 200 万元", occurredAt: day(-58) },
      { matterId: m1.id, eventType: "HEARING", title: "庭前会议完成证据交换", occurredAt: day(-12) },
      { matterId: m3.id, eventType: "PROCEDURE_CONCLUDED", title: "一审判决：部分胜诉", occurredAt: day(-24) },
      { matterId: m3.id, eventType: "PROCEDURE_ACCEPTED", title: "二审立案受理", occurredAt: day(-6) },
      { matterId: m8.id, eventType: "ARCHIVE_SUBMITTED", title: "提交归档申请", occurredAt: day(-2, 15) }
    ]
  });

  /* ── 清理指向已不存在业务记录的审计日志（旧模拟数据留下的孤儿记录会挤占「既往检索」「审批历史」等列表） ── */
  const existing = async (type: string): Promise<Set<string> | null> => {
    const pick = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
    switch (type) {
      case "Matter": return pick(await prisma.matter.findMany({ select: { id: true } }));
      case "Intake": return pick(await prisma.intake.findMany({ select: { id: true } }));
      case "Client": return pick(await prisma.client.findMany({ select: { id: true } }));
      case "Document": return pick(await prisma.document.findMany({ select: { id: true } }));
      case "ConflictCheck": return pick(await prisma.conflictCheck.findMany({ select: { id: true } }));
      case "SealRequest": return pick(await prisma.sealRequest.findMany({ select: { id: true } }));
      case "InvoiceRequest": return pick(await prisma.invoiceRequest.findMany({ select: { id: true } }));
      case "ArchiveRecord": return pick(await prisma.archiveRecord.findMany({ select: { id: true } }));
      case "MatterProcedure": return pick(await prisma.matterProcedure.findMany({ select: { id: true } }));
      case "MatterStage": return pick(await prisma.matterStage.findMany({ select: { id: true } }));
      case "Task": return pick(await prisma.task.findMany({ select: { id: true } }));
      case "FeeEntry": return pick(await prisma.feeEntry.findMany({ select: { id: true } }));
      case "PreservationProperty": return pick(await prisma.preservationProperty.findMany({ select: { id: true } }));
      case "Approval": {
        const sets = await Promise.all(["Intake", "Document", "SealRequest", "InvoiceRequest", "ArchiveRecord"].map((t) => existing(t)));
        return new Set(sets.flatMap((x) => [...(x ?? [])]));
      }
      default: return null;
    }
  };
  let orphanAudits = 0;
  for (const type of ["Matter", "Intake", "Client", "Document", "ConflictCheck", "SealRequest", "InvoiceRequest", "ArchiveRecord", "MatterProcedure", "MatterStage", "Task", "FeeEntry", "PreservationProperty", "Approval"]) {
    const ids = await existing(type);
    if (!ids) continue;
    const res = await prisma.auditLog.deleteMany({ where: { targetType: type, OR: [{ targetId: null }, { targetId: { notIn: [...ids] } }] } });
    orphanAudits += res.count;
  }
  console.log(`✓ 已清理指向已删除业务记录的审计日志 ${orphanAudits} 条（登录、账号与系统设置类审计保留）`);

  const counts = await Promise.all([prisma.client.count(), prisma.intake.count(), prisma.matter.count(), prisma.document.count({ where: { templateBlobOf: null } }), prisma.feeEntry.count()]);
  console.log(`✓ 完成：客户 ${counts[0]}、收案 ${counts[1]}、案件 ${counts[2]}、材料 ${counts[3]}、收付流水 ${counts[4]}`);
  console.log("  演示账号（密码同当前超级管理员）：zhoulan / shenqing / linmo / chenxiao / hejing / wanglu @lawlink.local");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
