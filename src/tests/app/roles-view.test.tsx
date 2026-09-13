import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { save, saveBuiltin, refresh } = vi.hoisted(() => ({ save: vi.fn(), saveBuiltin: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/server/roles/actions", () => ({ saveRoleDefinition: save, saveBuiltinRolePresentation: saveBuiltin }));
import { RolesView } from "@/app/(admin)/admin/roles/_components/roles-view";
const role = { id: "cmrolescustomverification1", name: "档案专员", normalizedName: "档案专员", description: "日常行政事务", active: true, version: 2, permissions: [{ roleId: "cmrolescustomverification1", permissionKey: "express.manage", scope: "OWN" }], _count: { users: 2 }, createdAt: new Date(), updatedAt: new Date() };
beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue({ id: role.id }); });
afterEach(cleanup);
describe("角色管理界面", () => {
  it("新增角色保存所选名称、权限和范围", async () => {
    render(<RolesView roles={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "新增角色" }));
    fireEvent.change(screen.getByLabelText("角色名称"), { target: { value: "档案管理员" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "查看归档" }));
    fireEvent.change(screen.getByRole("combobox", { name: "查看归档的数据范围" }), { target: { value: "TEAM" } });
    fireEvent.click(screen.getByRole("button", { name: "保存角色" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "档案管理员", permissions: [{ permissionKey: "archive.read", scope: "TEAM" }] })));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
  it("停用角色明确展示影响人数，并保存当前版本防止覆盖", async () => {
    render(<RolesView roles={[role]} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "启用此角色" }));
    expect(screen.getByText(/影响账号：2 人/)).toBeVisible();
    expect(screen.getByText(/所属账号暂停业务访问及审批资格/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存角色" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: role.id, version: 2, active: false })));
  });
  it("五个内置业务角色可编辑资料但不能删除", () => {
    render(<RolesView roles={[]} />);
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "复制新建" })).toHaveLength(5);
    expect(screen.getAllByRole("button", { name: /^编辑.*的名称和介绍$/ })).toHaveLength(5);
  });
});

it("内置编辑表单只保存显示资料，不出现权限或启停选项", async () => {
  render(<RolesView roles={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑主办律师的名称和介绍" }));
  fireEvent.change(screen.getByLabelText("角色名称"), { target: { value: "系统管理员" } });
  fireEvent.change(screen.getByLabelText("角色介绍"), { target: { value: "维护系统与账号" } });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保存资料" }));
  await waitFor(() => expect(saveBuiltin).toHaveBeenCalledWith({ id: "PRINCIPAL_LAWYER", name: "系统管理员", description: "维护系统与账号", version: 0 }));
  expect(save).not.toHaveBeenCalled();
});
it("行政固定记录归入内置区，不再提供自定义权限编辑入口", () => {
  render(<RolesView roles={[{ ...role, id: "cmrolesadministrative00001", name: "行政" }]} />);
  expect(screen.getByRole("button", { name: "编辑行政的名称和介绍" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^编辑$/ })).not.toBeInTheDocument();
});
