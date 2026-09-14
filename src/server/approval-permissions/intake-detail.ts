import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import { decryptIdNumber } from "@/lib/clients/id-number-crypto";
import { clientIdTypeLabel } from "@/lib/clients/person-id";
import { barFilingLabel, clientTypeLabel, conflictConclusionLabel, feeTypeLabel, litigationStandingLabel, matterCategoryLabel, matterCategoryKind, partyTypeLabel, procedureTypeLabel } from "@/lib/enums";
import { buildIntakeConflictQueries, conflictPartyRoleLabel, conflictQueryCoverage, readConflictPayload, type IntakeReviewField, type IntakeReviewSection } from "@/lib/approvals/intake-detail";

/** 自然人证件字段标签：身份证显示「身份证号」，其他证件带证件类型名 */
function personIdLabel(idType: string | null | undefined) {
  if (!idType || idType === "ID_CARD" || idType === "USCC") return "身份证号";
  return `证件号码（${clientIdTypeLabel[idType as keyof typeof clientIdTypeLabel] ?? "其他证件"}）`;
}

/** 仅由 getApprovalDetail 在 requireApprovalRecord 对象级鉴权成功后调用。 */
export async function loadIntakeApprovalDetail(id: string) {
  const r = await prisma.intake.findUniqueOrThrow({ where: { id }, include: {
    client: { select: { name: true, type: true, idType: true, idNumber: true, address: true, legalRep: true } },
    ownerUser: { select: { name: true } }, cause: { select: { name: true } },
    parties: { orderBy: [{ role: "asc" }, { ordinal: "asc" }] },
    documents: { where: { deletedAt: null }, select: { id: true, name: true } },
    conflictChecks: { orderBy: [{ checkedAt: "desc" }, { id: "desc" }], include: { hits: true, decidedBy: { select: { name: true } } } }
  } });
  const coUsers = r.coUserIds.length ? await prisma.user.findMany({ where: { id: { in: r.coUserIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(coUsers.map(u => [u.id, u.name]));
  const field = (label: string, value: unknown, sensitive = false): IntakeReviewField => ({ label, value: value == null || value === "" ? "未填写" : value instanceof Date ? formatDate(value) : String(value), sensitive });
  // 字段联动：只展示与所选案件类别 / 主体类型 / 收费方式相符的项目（2026-09-14 用户确认）
  const kind = matterCategoryKind(r.category);
  const litigation = kind === "litigation";
  const when = (cond: boolean, ...fields: IntakeReviewField[]) => (cond ? fields : []);
  const clientIsPerson = (r.client?.type ?? r.clientType) === "INDIVIDUAL";
  // 证件号码在审批中直接明文展示（审批授权已在 requireApprovalRecord 对象级校验；2026-09-14 用户确认）
  const clientId = decryptIdNumber(r.client?.idNumber) || null;
  const sections: IntakeReviewSection[] = [
    { title: "基本情况与承办人员", fields: [
      field("案件名称", r.title), field("案件类别", matterCategoryLabel[r.category]), field("收案日期", r.receivedAt),
      field("案由", r.cause?.name ?? r.causeFreeText),
      ...when(Boolean(r.cause && r.causeFreeText && r.causeFreeText !== r.cause.name), field("补充案由", r.causeFreeText)),
      field("事实摘要", r.description, true),
      field("主办律师", r.ownerUser?.name), field("共同承办律师", r.coUserIds.map(userId => names.get(userId) ?? "历史账号（姓名无法核实）").join("、")),
      ...when(r.status === "NEEDS_REVISION" || r.status === "DECLINED" || Boolean(r.declinedReason), field(r.status === "DECLINED" ? "不接案说明" : "补正说明", r.declinedReason))
    ] },
    ...(litigation ? [{ title: "程序与标的", fields: [
      field("首个程序 / 审级", r.firstProcedureType && procedureTypeLabel[r.firstProcedureType]), field("委托方诉讼地位", r.ourStanding && litigationStandingLabel[r.ourStanding]),
      field("办理机构", r.firstAgency), field("管辖地", r.jurisdiction), field("标的金额（元）", r.claimAmount), field("非金钱标的", r.claimDescription),
      field("律协备案", r.barFiling && barFilingLabel[r.barFiling]), field("是否反诉", r.counterclaim ? "是" : "否")
    ] }] : []),
    ...(kind === "project" ? [{ title: "非诉 / 专项服务", fields: [
      field("业务类型", r.businessType), field("项目金额（元）", r.claimAmount), field("服务范围", r.serviceScope), field("交付成果", r.deliverables),
      field("服务开始日期", r.serviceStart), field("服务结束日期", r.serviceEnd)
    ] }] : []),
    ...(kind === "counsel" ? [{ title: "顾问服务", fields: [
      field("顾问类型", r.counselType), field("服务范围", r.serviceScope), field("顾问期限起", r.serviceStart), field("顾问期限止", r.serviceEnd)
    ] }] : []),
    { title: "委托方与联系人", note: "委托方名称、主体类型及企业资料为关联客户档案当前值；联系人为本申请保存内容。", fields: [
      field("委托方", r.client?.name),
      field("主体类型", r.client ? clientTypeLabel[r.client.type] : r.clientType && clientTypeLabel[r.clientType]),
      // 仅当申请时登记的类型与档案当前类型不一致时才需要提示
      ...when(Boolean(r.client && r.clientType && r.clientType !== r.client.type), field("申请时登记的客户类型", r.clientType && clientTypeLabel[r.clientType])),
      field(clientIsPerson ? personIdLabel(r.client?.idType) : "统一社会信用代码", clientId),
      field(clientIsPerson ? "住址" : "注册地址", r.client?.address, true),
      ...when(!clientIsPerson, field("法定代表人", r.client?.legalRep)),
      field("联系人", r.contactName), field("联系电话", r.contactPhone, true)
    ] },
    ...r.parties.map((p, i) => {
      const person = p.partyType === "NATURAL_PERSON";
      return { title: `当事人 ${i + 1}：${p.name}`, fields: [
        field("姓名 / 名称", p.name), field("本案角色", conflictPartyRoleLabel[p.role]),
        ...when(litigation, field("诉讼地位", p.standing && litigationStandingLabel[p.standing])),
        field("主体类型", partyTypeLabel[p.partyType]),
        ...(person
          ? [field(personIdLabel(p.idType), p.idNumber)]
          : [
              field("统一社会信用代码", p.enterpriseSocialCode),
              ...when(Boolean(p.enterpriseName && p.enterpriseName !== p.name), field("工商登记名称", p.enterpriseName)),
              field("法定代表人", p.legalRep)
            ]),
        field(person ? "住址" : "地址", p.address, true), field("电话", p.phone, true),
        ...when(!person, field("经办联系人", p.contactName)),
        field("备注", p.notes)
      ] };
    }),
    { title: "收费安排", fields: [
      field("收费方式", r.feeType && feeTypeLabel[r.feeType]),
      ...when(Boolean(r.feeType), field(r.feeType === "CONTINGENCY" ? "基础办案费（元）" : r.feeType === "TIMED" ? "小时费率（元/时）" : "收费金额（元）", r.feeAmount)),
      ...when(r.feeType === "CONTINGENCY", field("风险代理收费方式", r.contingencyTerms)),
      field("付款节点", r.feeSchedule), field("收费说明", r.feeNote)
    ] }
  ];
  const matterIds = [...new Set(r.conflictChecks.flatMap(c => c.hits.filter(h => h.targetType === "Matter").map(h => h.targetId)))];
  const [matters, decisions] = await Promise.all([
    matterIds.length ? prisma.matter.findMany({ where: { id: { in: matterIds }, deletedAt: null }, select: {
      id: true, internalCode: true, title: true, owner: { select: { name: true } },
      parties: { select: { name: true, idNumber: true, enterpriseSocialCode: true, role: true, standing: true } }
    } }) : [],
    r.conflictChecks.length ? prisma.auditLog.findMany({ where: { action: "CONFLICT_CONCLUSION_SET", targetType: "ConflictCheck", targetId: { in: r.conflictChecks.map(c => c.id) } }, select: { targetId: true } }) : []
  ]);
  const byId = new Map(matters.map(m => [m.id, m]));
  const manuallySet = new Set(decisions.map(d => d.targetId));
  const expected = buildIntakeConflictQueries(r, decryptIdNumber);
  const checks = r.conflictChecks.map(c => {
    const payload = readConflictPayload(c.queryPayload);
    const automatic = !manuallySet.has(c.id) && c.conclusion === "DIFFERENT" && !c.hits.length && c.note === "系统自动标记：未命中历史案件冲突。";
    return {
      id: c.id, checkedAt: c.checkedAt, conclusion: automatic ? "未命中（系统自动提示）" : conflictConclusionLabel[c.conclusion],
      source: manuallySet.has(c.id) ? "人工设置结论" : automatic ? "系统检索结果，尚非人工确认" : "待核实",
      decidedBy: automatic ? null : c.decidedBy?.name ?? null, decidedAt: automatic ? null : c.decidedAt, note: c.note,
      coversCurrentParties: conflictQueryCoverage(expected, payload.queries), ...payload,
      hits: c.hits.map(h => {
        const m = h.targetType === "Matter" ? byId.get(h.targetId) : undefined;
        const matched = m?.parties.filter(p => h.matchedField === "name" ? p.name === h.matchedName : h.matchedField === "idNumber" ? p.idNumber === h.matchedValue : h.matchedField === "enterpriseSocialCode" ? p.enterpriseSocialCode === h.matchedValue : false) ?? [];
        return { id: h.id, matchedName: h.matchedName, matchedField: h.matchedField, matchedValue: h.matchedValue, matchedRatio: h.matchedRatio, severity: h.severity, reason: h.reason,
          matter: m ? { code: m.internalCode, title: m.title, ownerName: m.owner?.name ?? "未记录", roles: [...new Set(matched.map(p => `${conflictPartyRoleLabel[p.role]}${p.standing ? ` · ${litigationStandingLabel[p.standing]}` : ""}`))].join("、") || "当前档案无法核实命中角色" } : null };
      })
    };
  });
  return { sections, currentParties: expected, checks, attachments: r.documents };
}
