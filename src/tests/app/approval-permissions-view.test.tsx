import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { save, refresh } = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue(undefined), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/server/approval-permissions/actions", () => ({ saveApprovalSettings: save, savePermissionGroup: vi.fn(), saveSealPurpose: vi.fn() }));
import { PermissionAdministration } from "@/app/(admin)/admin/approval-permissions/permissions-view";
afterEach(cleanup);
describe("事项审批设置页面", () => {
  it("直接按事项授权，只保存本人审批设置，不提供旧角色切换入口", async () => {
    render(<PermissionAdministration data={{ groups: [], purposes: [], users: [], settings: { enabled: true, allowSelfApproval: false } }} />);
    expect(screen.getByRole("heading", { name: "按事项授权" })).toBeVisible();
    expect(screen.queryByText(/旧角色|启用新规则|准备启用/)).not.toBeInTheDocument();
    expect(screen.getByText(/系统超级管理员也必须加入相应权限组/)).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: /允许审批本人申请/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存本人审批设置" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ allowSelfApproval: true }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});
