import React, { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Input } from "@/components/ui/input";
afterEach(cleanup);

describe("中文文件选择控件", () => {
  it("保留原生字段、引用和所选文件，多选时中文显示文件名", () => {
    const ref = createRef<HTMLInputElement>(); const change = vi.fn();
    render(<Input ref={ref} type="file" name="invoice" aria-label="电子发票" multiple required accept=".pdf" onChange={change} />);
    const input = screen.getByLabelText("电子发票");
    expect(input).toBe(ref.current); expect(input).toBeRequired(); expect(input).toHaveAttribute("accept", ".pdf");
    expect(screen.getByText("选择文件")).toBeVisible(); expect(screen.getByText("未选择文件")).toBeVisible();
    const files = [new File(["a"], "发票.pdf"), new File(["b"], "Invoice-02.pdf")];
    fireEvent.change(input, { target: { files } });
    expect(change).toHaveBeenCalledOnce(); expect(ref.current?.files).toEqual(files);
    expect(screen.getByText("发票.pdf、Invoice-02.pdf")).toBeVisible();
    expect(input).toHaveAccessibleDescription("发票.pdf、Invoice-02.pdf");
  });
  it("取消选择保留原选择，表单重置恢复中文空状态", async () => {
    const ref = createRef<HTMLInputElement>();
    render(<form aria-label="上传表单"><Input type="file" ref={ref} aria-label="附件" /><button type="reset">重置</button></form>);
    fireEvent.change(ref.current!, { target: { files: [new File(["a"], "合同.pdf")] } });
    fireEvent(ref.current!, new Event("cancel", { bubbles: true }));
    expect(screen.getByText("合同.pdf")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    await waitFor(() => expect(screen.getByText("未选择文件")).toBeVisible());
  });
  it("禁用状态和普通输入框语义保留", () => {
    render(<><Input type="file" aria-label="附件" disabled /><Input aria-label="标题" defaultValue="原文" /></>);
    expect(screen.getByLabelText("附件")).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("原文");
  });
});
