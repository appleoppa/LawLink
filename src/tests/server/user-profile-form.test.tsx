import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
const { save, signOut, refresh } = vi.hoisted(() => ({ save: vi.fn(), signOut: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/users/profile-actions", () => ({ updateMyProfile: save }));
vi.mock("@/server/users/actions", () => ({ updateUserProfile: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next-auth/react", () => ({ signOut }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { ProfileBasicsForm } from "@/components/users/profile-basics-form";
const profile = { name: "表单测试", email: "profile@example.invalid", phone: "13800000000", updatedAt: "2026-09-06T00:00:00.000Z" };
beforeEach(() => { vi.resetAllMocks(); save.mockResolvedValue({ emailChanged: false }); });
describe("个人资料表单", () => {
  it("手机号默认打码；未编辑时不提交手机号", async () => {
    render(<ProfileBasicsForm profile={profile} />);
    expect(screen.getByText("138****0000")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(profile.phone)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存基本资料" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].phone).toBeUndefined();
  });
  it("旧电话不符合新格式时仍可单独维护姓名", async () => {
    render(<ProfileBasicsForm profile={{ ...profile, phone: "旧资料待补" }} />);
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "新姓名" } });
    fireEvent.click(screen.getByRole("button", { name: "保存基本资料" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].name).toBe("新姓名");
  });
  it("可以主动登记、修改、清空手机号", async () => {
    render(<ProfileBasicsForm profile={profile} />);
    fireEvent.click(screen.getByRole("button", { name: "查看 / 修改" }));
    fireEvent.change(screen.getByLabelText("手机号"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存基本资料" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].phone).toBe("");
  });
  it("修改邮箱显示密码验证，保存后引导重新登录", async () => {
    save.mockResolvedValue({ emailChanged: true });
    render(<ProfileBasicsForm profile={profile} />);
    fireEvent.change(screen.getByLabelText("邮箱（登录账号）"), { target: { value: "new@example.invalid" } });
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "fixture-password" } });
    fireEvent.click(screen.getByRole("button", { name: "保存基本资料" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login" }));
    expect(save.mock.calls[0][0].currentPassword).toBe("fixture-password");
  });
});
