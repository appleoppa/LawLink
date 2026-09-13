// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

const { db } = vi.hoisted(() => {
  return {
    db: {
      systemSetting: { findUnique: vi.fn() },
      sealTypeConfig: { findUnique: vi.fn() }
    }
  };
});

import {
  selfConfirmEligible, sanitizeSelfConfirmList, loadSelfConfirmList,
  SELF_CONFIRM_CONFIGURABLE_ACTIONS
} from "@/lib/approvals/self-confirm";

function configWith(items: unknown[]) {
  db.systemSetting.findUnique.mockResolvedValue({ value: { items } });
}

describe("自确认清单·配置清洗", () => {
  it("硬排除动作被拒绝：归档/开票/回填不可入清单", () => {
    const clean = sanitizeSelfConfirmList({
      items: [
        { action: "ARCHIVE_APPROVE" },
        { action: "INVOICE_APPROVE" },
        { action: "SEAL_STAMP" },
        { action: "DOCUMENT_APPROVE", categories: [] }
      ]
    });
    expect(clean.items.map(i => i.action)).toEqual(["DOCUMENT_APPROVE"]);
  });

  it("非白名单动作与重复条目被清洗", () => {
    const clean = sanitizeSelfConfirmList({
      items: [
        { action: "USER_ROLE_UPDATE" },
        { action: "SEAL_APPROVE" },
        { action: "SEAL_APPROVE", categories: ["CIVIL_COMMERCIAL"] }
      ]
    });
    expect(clean.items).toHaveLength(1);
    expect(clean.items[0].action).toBe("SEAL_APPROVE");
  });

  it("空/畸形输入安全归空清单", () => {
    expect(sanitizeSelfConfirmList(null).items).toEqual([]);
    expect(sanitizeSelfConfirmList({ items: "x" }).items).toEqual([]);
    expect(loadSelfConfirmListDbNull()).resolves.toEqual({ items: [] });
    async function loadSelfConfirmListDbNull() {
      db.systemSetting.findUnique.mockResolvedValue(null);
      return loadSelfConfirmList(db as never);
    }
  });
});

describe("自确认资格判定", () => {
  it("未配置清单时恒为 false", async () => {
    configWith([]);
    expect(await selfConfirmEligible({ action: "DOCUMENT_APPROVE", category: null, requesterId: "u1" }, db as never)).toBe(false);
  });

  it("动作命中且无类别限制 → true；类别不匹配 → false", async () => {
    configWith([{ action: "DOCUMENT_APPROVE", categories: [] }]);
    expect(await selfConfirmEligible({ action: "DOCUMENT_APPROVE", category: "CIVIL_COMMERCIAL", requesterId: "u1" }, db as never)).toBe(true);
    configWith([{ action: "DOCUMENT_APPROVE", categories: ["CRIMINAL"] }]);
    expect(await selfConfirmEligible({ action: "DOCUMENT_APPROVE", category: "CIVIL_COMMERCIAL", requesterId: "u1" }, db as never)).toBe(false);
  });

  it("硬排除动作直接 false（不看清单）", async () => {
    configWith([{ action: "ARCHIVE_APPROVE" }]); // 清洗不会存入，但防御性验证判定层
    expect(await selfConfirmEligible({ action: "ARCHIVE_APPROVE", category: null, requesterId: "u1" }, db as never)).toBe(false);
    expect(await selfConfirmEligible({ action: "INVOICE_APPROVE", category: null, requesterId: "u1" }, db as never)).toBe(false);
  });

  it("法定代表人章（显式或 requiresLegalRep）恒 false；停用章种 false", async () => {
    configWith([{ action: "SEAL_APPROVE", sealTypes: [] }]);
    db.sealTypeConfig.findUnique.mockResolvedValue({ enabled: true, requiresLegalRep: false });
    expect(await selfConfirmEligible({ action: "SEAL_APPROVE", category: null, requesterId: "u1", sealType: "OFFICIAL_SEAL" }, db as never)).toBe(true);

    db.sealTypeConfig.findUnique.mockResolvedValue({ enabled: true, requiresLegalRep: true });
    expect(await selfConfirmEligible({ action: "SEAL_APPROVE", category: null, requesterId: "u1", sealType: "CONTRACT_SEAL" }, db as never)).toBe(false);

    db.sealTypeConfig.findUnique.mockResolvedValue({ enabled: true, requiresLegalRep: false });
    expect(await selfConfirmEligible({ action: "SEAL_APPROVE", category: null, requesterId: "u1", sealType: "LEGAL_REP_SEAL" }, db as never)).toBe(false);

    db.sealTypeConfig.findUnique.mockResolvedValue(null);
    expect(await selfConfirmEligible({ action: "SEAL_APPROVE", category: null, requesterId: "u1", sealType: "OFFICIAL_SEAL" }, db as never)).toBe(false);
  });

  it("印章范围限定：清单限公章时合同章不命中", async () => {
    configWith([{ action: "SEAL_APPROVE", sealTypes: ["OFFICIAL_SEAL"] }]);
    db.sealTypeConfig.findUnique.mockResolvedValue({ enabled: true, requiresLegalRep: false });
    expect(await selfConfirmEligible({ action: "SEAL_APPROVE", category: null, requesterId: "u1", sealType: "OFFICIAL_SEAL" }, db as never)).toBe(true);
    expect(await selfConfirmEligible({ action: "SEAL_APPROVE", category: null, requesterId: "u1", sealType: "CONTRACT_SEAL" }, db as never)).toBe(false);
  });

  it("可配置动作白名单不含高风险项", () => {
    expect(SELF_CONFIRM_CONFIGURABLE_ACTIONS).not.toContain("ARCHIVE_APPROVE");
    expect(SELF_CONFIRM_CONFIGURABLE_ACTIONS).not.toContain("INVOICE_APPROVE");
    expect(SELF_CONFIRM_CONFIGURABLE_ACTIONS).not.toContain("SEAL_STAMP");
  });
});
