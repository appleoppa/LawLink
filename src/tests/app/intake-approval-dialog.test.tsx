import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "@/components/ui/dialog";
import { IntakeApprovalDialog } from "@/app/(app)/approvals/intake-approval-dialog";
import type { getApprovalDetail } from "@/server/approval-permissions/inbox";

type Detail = Awaited<ReturnType<typeof getApprovalDetail>>;
const intakeDetail: NonNullable<Detail["intakeDetail"]> = {
  rounds: [], currentParties: [],
  sections: [{ title: "程序与标的", fields: [{ label: "办理机构", value: "未填写" }, { label: "非金钱标的", value: "未填写" }, { label: "标的金额（元）", value: "0" }] }],
  checks: [],
};
const base = {
  title: "测试申请", requester: "测试申请人", submittedAt: new Date("2026-09-06T10:00:00Z"), status: "PENDING", task: "approve",
  intakeDetail, fields: [], history: [], attachments: [{ id: "readable", name: "可读材料.pdf", readable: true }, { id: "private", name: "不可读材料.pdf", readable: false }],
  canResubmit: false, canCancel: false, sealType: null, archiveReview: null,
} satisfies Detail;
function Harness({ detail = base, onDecision = vi.fn() }: { detail?: Detail; onDecision?: (decision: "approve" | "reject" | "revision") => void }) {
  const [note, setNote] = useState("");
  return <Dialog open><IntakeApprovalDialog detail={detail} intakeDetail={intakeDetail} note={note} onNoteChange={setNote} pending={false} onDecision={onDecision} onResubmit={vi.fn()} /></Dialog>;
}
const tab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });
afterEach(cleanup);
describe("立案审批分区审阅", () => {
  it("切换风险、附件与历史仍保留审批意见，附件权限继续逐件生效", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox", { name: "审批意见或驳回原因" }), { target: { value: "需要核实代理关系" } });
    fireEvent.click(screen.getByRole("button", { name: /尚未检索/ }));
    expect(screen.getByText(/尚未运行利益冲突检索/)).toBeVisible();
    tab(/^附件/);
    expect(screen.getByRole("link", { name: "查看附件：可读材料.pdf" })).toHaveAttribute("href", "/api/documents/readable/download?inline=1");
    expect(screen.queryByRole("link", { name: /不可读/ })).not.toBeInTheDocument();
    expect(screen.getByText("当前无附件读取权限")).toBeVisible();
    tab(/^处理记录/);
    expect(screen.getByText("尚无处理记录")).toBeVisible();
    expect(screen.getByRole("textbox")).toHaveValue("需要核实代理关系");
  });
  it("关键缺项和零金额可见，非关键缺项可展开，不隐藏已填资料", () => {
    render(<Harness />);
    expect(screen.getByText("办理机构")).toBeVisible();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    const toggle = screen.getByRole("button", { name: "未填写 1 项" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("非金钱标的")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("非金钱标的")).toBeVisible();
  });
  it("只读记录不出现审批入口，处理按钮仍分别调用原有决定", () => {
    const onDecision = vi.fn();
    const { unmount } = render(<Harness onDecision={onDecision} />);
    fireEvent.click(screen.getByRole("button", { name: "退回补正" }));
    expect(onDecision).toHaveBeenCalledWith("revision");
    fireEvent.click(screen.getByRole("button", { name: "驳回" }));
    expect(onDecision).toHaveBeenCalledWith("reject");
    // 墨案 07：通过前须勾选两项核对确认
    expect(screen.getByRole("button", { name: "审批通过" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /已核对申请资料/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /同意按申请登记/ }));
    fireEvent.click(screen.getByRole("button", { name: "审批通过" }));
    expect(onDecision).toHaveBeenCalledWith("approve");
    unmount();
    render(<Harness detail={{ ...base, task: null, status: "CONVERTED" }} />);
    expect(screen.queryByRole("button", { name: "审批通过" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/当前为只读查阅/)).toBeVisible();
  });
});
