import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { FormDialogBody, FormDialogContent } from "@/components/patterns/form-dialog";
import { MatterCombobox } from "@/app/(app)/approvals/seals/_components/matter-combobox";

beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Form() {
  const [open, setOpen] = useState(true);
  return <Dialog open={open} onOpenChange={setOpen}><FormDialogContent><DialogHeader><DialogTitle>申请表</DialogTitle><DialogDescription>填写资料</DialogDescription></DialogHeader><FormDialogBody><input aria-label="填写中内容" defaultValue="保留这段草稿" /><MatterCombobox matters={[]} value="" onChange={() => {}} placeholder="选择关联案件" /></FormDialogBody><DialogFooter><button onClick={() => setOpen(false)}>取消</button></DialogFooter></FormDialogContent></Dialog>;
}
describe("统一表单中的嵌套菜单", () => {
  it("Esc 仅关闭案件菜单，继续保留申请窗口与草稿", async () => {
    render(<Form />);
    fireEvent.click(screen.getByRole("combobox"));
    const query = await screen.findByPlaceholderText("输入编号或案件名片段...");
    fireEvent.keyDown(query, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByPlaceholderText("输入编号或案件名片段...")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "申请表" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "填写中内容" })).toHaveValue("保留这段草稿");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
