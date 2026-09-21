/**
 * 冲突检索算法（V2）
 *
 * 与 V1 的关键区别：
 *   - V1 把"客户库同名"也当作冲突命中并标 HIGH，会出现"自己跟自己冲突"
 *     的错觉（系统已有同名客户档案 ≠ 利益冲突）。
 *   - V2 严格把"利益冲突"定义为：候选当事人在过去 Matter 里的角色与本次
 *     候选角色组合构成冲突。命中只落在 Matter 上，不落在 Client。
 *   - 同名客户档案单独走 sameNameClients 提示，不染色、不计入 hits。
 *   - 身份证号一致 → 单独走 idMatchedClients（强提示，可点开人工核对）。
 *
 * 严重度判定：
 *   候选 CLIENT_PARTY  ×  历史 OPPOSING_PARTY  → HIGH        曾经的对手现在要变委托方
 *   候选 OPPOSING_PARTY × 历史 CLIENT_PARTY    → BLOCKING    拟代理的对方曾是我所客户
 *   候选 OPPOSING_PARTY × 历史 OPPOSING_PARTY  → LOW         历史交锋提示，可继续办
 *   候选 CLIENT_PARTY  ×  历史 CLIENT_PARTY    → LOW         熟客户复办
 *   候选 THIRD_PARTY    × 任何                  → MEDIUM
 *   身份证一致 → 在原严重度基础上升 1 级（BLOCKING 顶天）
 *
 * 检索范围（2026-09-14 用户确认）：历史案件当事人、客户档案关联案件，以及尚未转为案件的在办收案
 * （INTAKE / PENDING_CONFIRMATION / NEEDS_REVISION）的当事人与委托方。在办收案命中只披露收案名称、
 * 登记人、状态、登记日期与命中角色（targetType = "Intake"），不开放收案内容。
 *
 * 名称匹配（2026-09-21 第六轮体检 P2-2）：单向 contains 改为「探针扩候选 + 归一双向比对」
 * （src/lib/conflicts/name-normalize.ts）——全称/简称互查、组织后缀与括号地域差异不再漏检；
 * 归一命中降一级严重度并标注「请人工核对」，由律师判断（宁可降级提示，不可静默漏检）。
 */

import type { Prisma, PartyRole, LitigationStanding, MatterCategory, MatterStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { blindIdNumber } from "@/lib/clients/id-number-crypto";
import { normalizeIdNumber } from "@/lib/clients/identity";
import { buildNameProbes, nameMatchLevel, isNormalizedMatch } from "@/lib/conflicts/name-normalize";

export type QueryItem = {
  role: PartyRole;
  name: string;
  idNumber?: string;
};

export type MatterInfoForHit = {
  matterId: string;
  internalCode: string;
  title: string;
  category: MatterCategory;
  status: MatterStatus;
  intakeDate: Date | null;
  causeText: string | null;
  ownerName: string | null;
  partyRole: PartyRole;
  partyStanding: LitigationStanding | null;
};

const matterInfoSelect = {
  id: true,
  internalCode: true,
  title: true,
  category: true,
  status: true,
  intakeDate: true,
  cause: { select: { name: true } },
  causeFreeText: true,
  owner: { select: { name: true } }
} as const;

type SelectedMatterInfo = Prisma.MatterGetPayload<{ select: typeof matterInfoSelect }>;

function toMatterInfo(
  matter: SelectedMatterInfo,
  partyRole: PartyRole,
  partyStanding: LitigationStanding | null
): MatterInfoForHit {
  return {
    matterId: matter.id,
    internalCode: matter.internalCode,
    title: matter.title,
    category: matter.category,
    status: matter.status,
    intakeDate: matter.intakeDate,
    causeText: matter.cause?.name ?? matter.causeFreeText ?? null,
    ownerName: matter.owner?.name ?? null,
    partyRole,
    partyStanding
  };
}

export const IN_PROGRESS_INTAKE_STATUSES = ["INTAKE", "PENDING_CONFIRMATION", "NEEDS_REVISION"] as const;

export type IntakeInfoForHit = {
  intakeId: string;
  title: string;
  status: (typeof IN_PROGRESS_INTAKE_STATUSES)[number];
  receivedAt: Date;
  registrantName: string | null;
  partyRole: PartyRole;
  partyStanding: LitigationStanding | null;
};

const intakeInfoSelect = {
  id: true,
  title: true,
  status: true,
  receivedAt: true,
  ownerUser: { select: { name: true } },
  createdBy: { select: { name: true } }
} as const;

type SelectedIntakeInfo = Prisma.IntakeGetPayload<{ select: typeof intakeInfoSelect }>;

function toIntakeInfo(intake: SelectedIntakeInfo, partyRole: PartyRole, partyStanding: LitigationStanding | null): IntakeInfoForHit {
  return {
    intakeId: intake.id,
    title: intake.title,
    status: intake.status as IntakeInfoForHit["status"],
    receivedAt: intake.receivedAt,
    registrantName: intake.ownerUser?.name ?? intake.createdBy?.name ?? null,
    partyRole,
    partyStanding
  };
}

export type ConflictHitDraft = {
  hitType: "HISTORICAL_PARTY" | "IN_PROGRESS_INTAKE";
  targetType: "Matter" | "Intake";
  targetId: string;
  matchedName: string;
  matchedField: "name" | "idNumber";
  matchedValue: string;
  matchedRatio: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "BLOCKING";
  reason: string;
  matterInfo: MatterInfoForHit | null;
  intakeInfo?: IntakeInfoForHit | null;
};

export type SameNameClient = {
  clientId: string;
  name: string;
};

export type IdMatchedClient = {
  clientId: string;
  name: string;
  idNumber: string;
};

export type ConflictCheckResult = {
  hits: ConflictHitDraft[];
  sameNameClients: SameNameClient[];
  idMatchedClients: IdMatchedClient[];
};

export function conflictHitKey(hit: { targetId: string; matchedField: string; matchedValue: string; matchedName: string }) {
  return JSON.stringify([hit.targetId, hit.matchedField, hit.matchedValue, hit.matchedName]);
}

const SEV_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2, BLOCKING: 3 } as const;
const SEV_BY_ORDER = ["LOW", "MEDIUM", "HIGH", "BLOCKING"] as const;

function bumpSeverity(s: ConflictHitDraft["severity"]): ConflictHitDraft["severity"] {
  return SEV_BY_ORDER[Math.min(SEV_ORDER[s] + 1, 3)];
}

/** 归一化命中降一级（第六轮体检 P2-2）：提示交律师判断，但不再直接阻断 */
function downgradeSeverity(s: ConflictHitDraft["severity"]): ConflictHitDraft["severity"] {
  return SEV_BY_ORDER[Math.max(SEV_ORDER[s] - 1, 0)];
}

function pickSeverity(
  candidateRole: PartyRole,
  historyRole: PartyRole
): ConflictHitDraft["severity"] {
  if (candidateRole === "THIRD_PARTY" || historyRole === "THIRD_PARTY") return "MEDIUM";
  if (candidateRole === "OPPOSING_PARTY" && historyRole === "CLIENT_PARTY") return "BLOCKING";
  if (candidateRole === "CLIENT_PARTY" && historyRole === "OPPOSING_PARTY") return "HIGH";
  if (candidateRole === "OPPOSING_PARTY" && historyRole === "OPPOSING_PARTY") return "LOW";
  if (candidateRole === "CLIENT_PARTY" && historyRole === "CLIENT_PARTY") return "LOW";
  return "MEDIUM";
}

/** excludeIntakeId：收案发起的正式检索须排除该收案自身的当事人 */
export async function runConflictCheck(queries: QueryItem[], options: { excludeIntakeId?: string; excludeMatterId?: string; db?: Prisma.TransactionClient } = {}): Promise<ConflictCheckResult> {
  const db=options.db??prisma;
  const hits: ConflictHitDraft[] = [];
  const sameNameClients = new Map<string, SameNameClient>();
  const idMatchedClients = new Map<string, IdMatchedClient>();

  for (const q of queries) {
    const name = q.name.trim();
    const idNumber = q.idNumber?.trim() || null;
    if (!name && !idNumber) continue;

    // v0.16: 同名 / 证件号匹配客户档案不再作为冲突提示
    //  (用户反馈：与利益冲突检索无关；保留 sameNameClients/idMatchedClients 数据
    //  结构以兼容历史 ConflictCheck 记录，但新检索时永远为空)

    // ============ 历史案件 Party 匹配 ============
    const partyWhere: Prisma.PartyWhereInput[] = [];
    if (name) partyWhere.push({ name });
    // 自然人证件存 idNumber，单位信用代码存 enterpriseSocialCode，两列都要比对；
    // 历史数据大小写不一（身份证尾号 x、小写信用代码），补规范化（大写）变体，否则同身份不同写法漏检
    const normId = idNumber ? normalizeIdNumber(idNumber) : null;
    if (idNumber) {
      partyWhere.push({ idNumber }, { enterpriseSocialCode: idNumber });
      if (normId && normId !== idNumber) partyWhere.push({ idNumber: normId }, { enterpriseSocialCode: normId });
    }
    if (partyWhere.length === 0) continue;
    // 客户档案证件号为密文，只能用盲索引精确比对
    const idBlind = idNumber ? blindIdNumber(normalizeIdNumber(idNumber) ?? idNumber) : null;

    const partiesExact = await db.party.findMany({
      where: {
        OR: partyWhere,
        matterId: { not: null },
        matter: { deletedAt: null, ...(options.excludeMatterId?{id:{not:options.excludeMatterId}}:{}) }
      },
      select: {
        id: true,
        name: true,
        idNumber: true,
        enterpriseSocialCode: true,
        role: true,
        standing: true,
        matter: {
          select: matterInfoSelect
        }
      }
    });

    for (const p of partiesExact) {
      if (!p.matter) continue;
      const matterInfo = toMatterInfo(p.matter, p.role, p.standing);

      // 身份证一致 → 在基础严重度上升 1 级
      if (idNumber && (p.idNumber === idNumber || p.enterpriseSocialCode === idNumber || (normId && (p.idNumber === normId || p.enterpriseSocialCode === normId)))) {
        const base = pickSeverity(q.role, p.role);
        const sev = bumpSeverity(base);
        hits.push({
          hitType: "HISTORICAL_PARTY",
          targetType: "Matter",
          targetId: p.matter.id,
          matchedName: p.name,
          matchedField: "idNumber",
          matchedValue: idNumber,
          matchedRatio: 1,
          severity: sev,
          reason: `身份证 / 信用代码与案件「${p.matter.internalCode}」中 ${roleLabel(p.role)}「${p.name}」一致`,
          matterInfo
        });
      }
      if (name && p.name === name) {
        const sev = pickSeverity(q.role, p.role);
        hits.push({
          hitType: "HISTORICAL_PARTY",
          targetType: "Matter",
          targetId: p.matter.id,
          matchedName: p.name,
          matchedField: "name",
          matchedValue: name,
          matchedRatio: 1,
          severity: sev,
          reason: `与案件「${p.matter.internalCode}」中 ${roleLabel(p.role)}「${p.name}」同名`,
          matterInfo
        });
      }
    }

    // Party 姓名模糊匹配（P2-2：探针扩候选 + 归一双向比对——此前单向 contains，
    // 查询全称/历史录简称（如「广东嘉吉贸易有限公司」vs「嘉吉贸易」）会整条漏检）
    const probes = buildNameProbes(name);
    if (probes.length > 0) {
      const partiesFuzzy = await db.party.findMany({
        where: {
          matterId: { not: null },
          matter: { deletedAt: null, ...(options.excludeMatterId?{id:{not:options.excludeMatterId}}:{}) },
          OR: probes.map((p) => ({ name: { contains: p, mode: "insensitive" } })),
          NOT: { name }
        },
        select: {
          id: true,
          name: true,
          role: true,
          standing: true,
          matter: {
            select: matterInfoSelect
          }
        },
        take: 20
      });
      for (const p of partiesFuzzy) {
        if (!p.matter) continue;
        const m = nameMatchLevel(name, p.name);
        if (!m || m.level === "EXACT") continue; // 精确分支已记
        const normalized = isNormalizedMatch(m);
        hits.push({
          hitType: "HISTORICAL_PARTY",
          targetType: "Matter",
          targetId: p.matter.id,
          matchedName: p.name,
          matchedField: "name",
          matchedValue: name,
          matchedRatio: m.ratio,
          severity: normalized ? downgradeSeverity(pickSeverity(q.role, p.role)) : "LOW",
          reason: `与案件「${p.matter.internalCode}」中 ${roleLabel(p.role)}「${p.name}」${normalized ? "名称归一化匹配，请人工核对" : "名称相似"}`,
          matterInfo: toMatterInfo(p.matter, p.role, p.standing)
        });
      }
    }

    // ============ 在办收案（尚未转为案件）============
    await collectIntakeHits(hits, q, name, idNumber, options.excludeIntakeId,db);

    // ============ v0.43: 客户档案 → 关联案件 检索（修复漏报）============
    // 老案件常只在 Matter.primaryClient / clientLinks 记客户、Party 表为空，
    // 上面的 Party 检索会漏掉。客户作为某案件的「委托方(CLIENT_PARTY)」是真实
    // 冲突信号，故按名称/证件号查 Client，再回溯其关联 Matter 产出命中。
    // 不滤 status（已归档/进行中都要提示）；孤立客户档案（无任何关联案件）不产出命中。
    const clientWhere: Prisma.ClientWhereInput[] = [];
    if (name) clientWhere.push({ name });
    if (idBlind) clientWhere.push({ idNumberBlind: idBlind });
    // P2-2：探针扩候选（原名 + 归一核 + 去地域核），命中经 nameMatchLevel 分类
    if (name) for (const p of probes) clientWhere.push({ name: { contains: p, mode: "insensitive" } });

    if (clientWhere.length > 0) {
      const clients = await db.client.findMany({
        where: { deletedAt: null, OR: clientWhere },
        select: {
          id: true,
          name: true,
          idNumberBlind: true,
          matters: { where: { deletedAt: null, ...(options.excludeMatterId?{id:{not:options.excludeMatterId}}:{}) }, select: matterInfoSelect },
          matterLinks: {
            where: { matter: { deletedAt: null, ...(options.excludeMatterId?{id:{not:options.excludeMatterId}}:{}) } },
            select: { matter: { select: matterInfoSelect } }
          }
        }
      });

      for (const c of clients) {
        // 该客户关联的全部案件（primaryClient + clientLinks），按 id 去重
        const matters = [...c.matters, ...c.matterLinks.map((l) => l.matter)].filter(
          (m, i, arr) => arr.findIndex((x) => x.id === m.id) === i
        );

        const idHit = !!(idBlind && c.idNumberBlind === idBlind);

        for (const m of matters) {
          const matterInfo = toMatterInfo(m, "CLIENT_PARTY", null);

          if (idHit) {
            const sev = bumpSeverity(pickSeverity(q.role, "CLIENT_PARTY"));
            hits.push({
              hitType: "HISTORICAL_PARTY",
              targetType: "Matter",
              targetId: m.id,
              matchedName: c.name,
              matchedField: "idNumber",
              matchedValue: idNumber!,
              matchedRatio: 1,
              severity: sev,
              reason: `身份证 / 信用代码与案件「${m.internalCode}」的委托方「${c.name}」一致`,
              matterInfo
            });
          }
          // P2-2：归一双向比对分级——归一命中降一级并标注人工核对
          const match = name ? nameMatchLevel(name, c.name) : null;
          if (match) {
            if (match.level === "EXACT") {
              hits.push({
                hitType: "HISTORICAL_PARTY",
                targetType: "Matter",
                targetId: m.id,
                matchedName: c.name,
                matchedField: "name",
                matchedValue: name,
                matchedRatio: 1,
                severity: pickSeverity(q.role, "CLIENT_PARTY"),
                reason: `与案件「${m.internalCode}」的委托方「${c.name}」同名`,
                matterInfo
              });
            } else if (match.level === "NORMALIZED_EQUAL") {
              hits.push({
                hitType: "HISTORICAL_PARTY",
                targetType: "Matter",
                targetId: m.id,
                matchedName: c.name,
                matchedField: "name",
                matchedValue: name,
                matchedRatio: 1,
                severity: downgradeSeverity(pickSeverity(q.role, "CLIENT_PARTY")),
                reason: `与案件「${m.internalCode}」的委托方「${c.name}」名称归一化匹配，请人工核对`,
                matterInfo
              });
            } else {
              hits.push({
                hitType: "HISTORICAL_PARTY",
                targetType: "Matter",
                targetId: m.id,
                matchedName: c.name,
                matchedField: "name",
                matchedValue: name,
                matchedRatio: match.ratio,
                severity: isNormalizedMatch(match) ? downgradeSeverity(pickSeverity(q.role, "CLIENT_PARTY")) : "LOW",
                reason: `与案件「${m.internalCode}」的委托方「${c.name}」${isNormalizedMatch(match) ? "名称归一化匹配，请人工核对" : "名称相似"}`,
                matterInfo
              });
            }
          }
        }
      }
    }
  }

  // 同案同查询下的不同命中名称必须保留；相同命中才合并最高严重度。
  const dedup = new Map<string, ConflictHitDraft>();
  for (const h of hits) {
    const key = conflictHitKey(h);
    const existing = dedup.get(key);
    if (!existing || SEV_ORDER[h.severity] > SEV_ORDER[existing.severity]) {
      dedup.set(key, h);
    }
  }
  const sortedHits = Array.from(dedup.values()).sort(
    (a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity]
  );

  return {
    hits: sortedHits,
    sameNameClients: Array.from(sameNameClients.values()),
    idMatchedClients: Array.from(idMatchedClients.values())
  };
}

async function collectIntakeHits(
  hits: ConflictHitDraft[],
  q: QueryItem,
  name: string,
  idNumber: string | null,
  excludeIntakeId: string | undefined,
  db: Prisma.TransactionClient
) {
  const intakeScope: Prisma.IntakeWhereInput = {
    status: { in: [...IN_PROGRESS_INTAKE_STATUSES] },
    ...(excludeIntakeId ? { id: { not: excludeIntakeId } } : {})
  };
  const push = (intake: SelectedIntakeInfo, matchedName: string, partyRole: PartyRole, standing: LitigationStanding | null, field: "name" | "idNumber", ratio: number, normalized = false) => {
    const base = pickSeverity(q.role, partyRole);
    const severity = field === "idNumber" ? bumpSeverity(base) : ratio < 1 || normalized ? (normalized ? downgradeSeverity(base) : "LOW") : base;
    const what = field === "idNumber" ? "身份证 / 信用代码一致" : normalized ? (ratio < 1 ? "名称归一化匹配，请人工核对" : "名称归一化相同，请人工核对") : ratio < 1 ? "名称相似" : "同名";
    hits.push({
      hitType: "IN_PROGRESS_INTAKE",
      targetType: "Intake",
      targetId: intake.id,
      matchedName,
      matchedField: field,
      matchedValue: field === "idNumber" ? idNumber! : name,
      matchedRatio: ratio,
      severity,
      reason: `与在办收案「${intake.title}」中 ${roleLabel(partyRole)}「${matchedName}」${what}`,
      matterInfo: null,
      intakeInfo: toIntakeInfo(intake, partyRole, standing)
    });
  };

  const normId = idNumber ? normalizeIdNumber(idNumber) : null;
  const exactOr: Prisma.PartyWhereInput[] = [];
  if (name) exactOr.push({ name });
  if (idNumber) {
    exactOr.push({ idNumber }, { enterpriseSocialCode: idNumber });
    if (normId && normId !== idNumber) exactOr.push({ idNumber: normId }, { enterpriseSocialCode: normId });
  }
  // P2-2：探针扩候选 + 归一双向比对分类
  const probes = name ? buildNameProbes(name) : [];
  const fuzzyOr: Prisma.PartyWhereInput[] = probes.map((p) => ({ name: { contains: p, mode: "insensitive" } }));
  if (exactOr.length || fuzzyOr.length) {
    // 精确/证件与模糊分两个查询：同名大姓的 contains 命中会把合并查询的 take:50 窗口挤满，
    // 静默挤掉证件级真命中；拆开后精确命中不受截断影响（与历史案件分支口径一致）
    const baseSelect = { id: true, name: true, idNumber: true, enterpriseSocialCode: true, role: true, standing: true, intake: { select: intakeInfoSelect } } as const;
    const parties = [
      ...await db.party.findMany({ where: { intakeId: { not: null }, intake: intakeScope, OR: exactOr }, select: baseSelect, take: 50 }),
      ...await db.party.findMany({ where: { intakeId: { not: null }, intake: intakeScope, OR: fuzzyOr, NOT: name ? [{ name }] : [] }, select: baseSelect, take: 20 })
    ];
    const seen = new Set<string>();
    for (const p of parties) {
      if (!p.intake || seen.has(p.id)) continue;
      seen.add(p.id);
      const idMatched = !!(idNumber && (p.idNumber === idNumber || p.enterpriseSocialCode === idNumber || (normId && (p.idNumber === normId || p.enterpriseSocialCode === normId))));
      if (idMatched) push(p.intake, p.name, p.role, p.standing, "idNumber", 1);
      const match = name ? nameMatchLevel(name, p.name) : null;
      if (!match) continue;
      if (match.level === "EXACT") push(p.intake, p.name, p.role, p.standing, "name", 1);
      else if (match.level === "NORMALIZED_EQUAL") push(p.intake, p.name, p.role, p.standing, "name", 1, true);
      else push(p.intake, p.name, p.role, p.standing, "name", match.ratio, isNormalizedMatch(match));
    }
  }

  // 收案关联的客户档案（部分收案委托方只挂 clientId、未落 Party 行）
  const clientOr: Prisma.ClientWhereInput[] = [];
  if (name) clientOr.push({ name });
  for (const p of probes) clientOr.push({ name: { contains: p, mode: "insensitive" } });
  const idBlind = idNumber ? blindIdNumber(normalizeIdNumber(idNumber) ?? idNumber) : null;
  if (idBlind) clientOr.push({ idNumberBlind: idBlind });
  if (clientOr.length) {
    const intakes = await db.intake.findMany({
      where: { ...intakeScope, client: { deletedAt: null, OR: clientOr }, parties: { none: { role: "CLIENT_PARTY" } } },
      select: { ...intakeInfoSelect, client: { select: { name: true, idNumberBlind: true } } },
      take: 50
    });
    for (const intake of intakes) {
      const c = intake.client;
      if (!c) continue;
      if (idBlind && c.idNumberBlind === idBlind) push(intake, c.name, "CLIENT_PARTY", null, "idNumber", 1);
      const match = name ? nameMatchLevel(name, c.name) : null;
      if (!match) continue;
      if (match.level === "EXACT") push(intake, c.name, "CLIENT_PARTY", null, "name", 1);
      else if (match.level === "NORMALIZED_EQUAL") push(intake, c.name, "CLIENT_PARTY", null, "name", 1, true);
      else push(intake, c.name, "CLIENT_PARTY", null, "name", match.ratio, isNormalizedMatch(match));
    }
  }
}

function roleLabel(role: PartyRole) {
  switch (role) {
    case "CLIENT_PARTY":
      return "委托方";
    case "OPPOSING_PARTY":
      return "对方";
    case "THIRD_PARTY":
      return "第三人";
    case "CO_LITIGANT":
      return "共同诉讼人";
    case "AGENT":
      return "代理人";
    case "WITNESS":
      return "证人";
    default:
      return "当事人";
  }
}
