import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { IntakeApprovalContent, IntakeReviewValue } from "@/app/(app)/approvals/intake-approval-content";
afterEach(cleanup);
describe("立案详情人工核查展示", () => {
  it("审批资料直接明文展示", () => {
    render(<IntakeReviewValue label="联系电话" value="TEST-PHONE" />);
    expect(screen.getByText("TEST-PHONE")).toBeInTheDocument();
  });
  it("无检索时不能显示无冲突结论", () => {
    render(<IntakeApprovalContent detail={{ sections: [], currentParties: [], checks: [] }} />);
    expect(screen.getByText(/尚未运行利益冲突检索/)).toBeInTheDocument();
    expect(screen.getByText(/不能代替审批判断/)).toBeInTheDocument();
  });
  it("展开相同、相似和证件结果，具体结果先于结论", () => {
    const base = { id: "exact", matchedField: "name", matchedValue: "测试公司", matchedName: "测试公司", matchedRatio: 1, severity: "LOW" as const, reason: "历史同名记录", intake: null, matter: { code: "TEST-001", title: "测试历史案件", ownerName: "测试律师", roles: "委托方" } };
    render(<IntakeApprovalContent view="conflicts" detail={{ sections: [], currentParties: [{ role: "OPPOSING_PARTY", name: "本案测试对方", idNumber: "" }], checks: [{
      id: "check", checkedAt: new Date(), conclusion: "待人工核实", source: "历史记录", decidedBy: null, decidedAt: null, note: null, coversCurrentParties: true, queries: [], sameNameClients: [], idMatchedClients: [],
      hits: [base, { ...base, id: "similar", matchedName: "测试公司分公司", matchedRatio: 0.6 }, { ...base, id: "id", matchedField: "idNumber", matchedValue: "TEST-SECRET-ID" }, { ...base, id: "old", matchedField: "legacy" }]
    }] }} />);
    const results = screen.getByRole("region", { name: "具体检索结果" });
    expect(screen.getByText("本案测试对方")).toBeInTheDocument();
    expect(screen.getByText("对方")).toBeInTheDocument();
    expect(screen.queryByText("角色未记录")).not.toBeInTheDocument();
    expect(within(results).getByRole("region", { name: "名称相同结果" })).toHaveTextContent("测试公司");
    expect(within(results).getByRole("region", { name: "名称相似结果" })).toHaveTextContent("测试公司分公司");
    expect(within(results).getByRole("region", { name: "其他历史匹配结果" })).toBeInTheDocument();
    expect(results).toHaveTextContent("TEST-001 · 测试历史案件");
    expect(results).toHaveTextContent("不代表同一主体概率");
    expect(results.compareDocumentPosition(screen.getByText("当前保存结论")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "证件一致结果" }))).toBeDefined();
    expect(screen.getByText("TEST-SECRET-ID")).toBeInTheDocument();
  });

});
