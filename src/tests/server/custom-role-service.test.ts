// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { db } = vi.hoisted(() => ({ db: { systemSetting: { findUnique: vi.fn() }, user: { findUnique: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn(), invoiceRequest: { count: vi.fn() } } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { resolveRoleUser, roleMutation } from "@/lib/roles/service";
import { canExecuteInvoice } from "@/lib/approvals/service";
const enabled = { active: true, role: "CUSTOM", roleDefinition: { active: true, name: "行政", permissions: [{ permissionKey: "announcements.manage", scope: "ALL" }] } };
beforeEach(() => { vi.resetAllMocks(); db.user.findUnique.mockResolvedValue(enabled); db.$transaction.mockImplementation(async fn => fn(db)); db.$queryRaw.mockResolvedValue([]); db.invoiceRequest.count.mockResolvedValue(1); });
describe("角色实时状态及撤权事务", () => {
  it("内置改名只更新实时显示，不改变系统角色", async () => { db.systemSetting.findUnique.mockResolvedValue({ value: { LAWYER: { name: "执业律师", description: "", version: 1 } } }); const user = await resolveRoleUser("u", "LAWYER"); expect(user.roleName).toBe("执业律师"); expect(user.role).toBe("LAWYER"); });
  it("内置角色实时读取个人管理授权，不查询自定义角色关系", async () => { db.user.findUnique.mockResolvedValue({ managerAuthorized: false }); expect((await resolveRoleUser("u", "LAWYER")).enabled).toBe(true); expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: "u" }, select: { managerAuthorized: true } }); });
  it("自定义角色读取当前名称和白名单权限", async () => { const access = await resolveRoleUser("u", "CUSTOM"); expect(access.enabled).toBe(true); expect(access.roleName).toBe("行政"); expect(access.rolePermissions).toHaveLength(1); });
  it.each([null, { ...enabled, active: false }, { ...enabled, roleDefinition: null }, { ...enabled, roleDefinition: { ...enabled.roleDefinition, active: false } }, { ...enabled, role: "LAWYER" }])("失效账号或角色不保留权限 %j", async row => { db.user.findUnique.mockResolvedValue(row); expect((await resolveRoleUser("u", "CUSTOM")).enabled).toBe(false); });
  it("业务写入先取得与角色配置共用的锁再执行", async () => { const write = vi.fn(async () => "saved"); expect(await roleMutation({ id: "u", role: "CUSTOM", rolePermissions: [{ permissionKey: "announcements.manage", scope: "ALL" }] }, "announcements.manage", write)).toBe("saved"); expect(db.$queryRaw).toHaveBeenCalledOnce(); expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0]); });
  it("旧页面的权限快照不能覆盖事务内的撤权结果", async () => { db.user.findUnique.mockResolvedValue({ ...enabled, roleDefinition: { ...enabled.roleDefinition, permissions: [] } }); const write = vi.fn(); await expect(roleMutation({ id: "u", role: "CUSTOM", rolePermissions: [{ permissionKey: "announcements.manage", scope: "ALL" }] }, "announcements.manage", write)).rejects.toThrow("无权"); expect(write).not.toHaveBeenCalled(); });
  it("权限未撤销但范围从全所收窄到本人时，旧页面不能沿用全所范围", async () => {
    db.user.findUnique.mockResolvedValue({ ...enabled, roleDefinition: { ...enabled.roleDefinition, permissions: [{ permissionKey: "finance.write", scope: "OWN" }] } });
    const write = vi.fn();
    await expect(roleMutation({ id: "u", role: "CUSTOM", rolePermissions: [{ permissionKey: "finance.write", scope: "ALL" }] }, "finance.write", write)).rejects.toThrow("范围已变化");
    expect(write).not.toHaveBeenCalled();
  });
  it("内置角色沿用原写入事务路径", async () => { const write = vi.fn(async () => 1); await roleMutation({ id: "u", role: "LAWYER" }, "announcements.manage", write); expect(db.$transaction).not.toHaveBeenCalled(); });
});
describe("开票执行与审批分开", () => {
  it("普通行政不能因审批职责或申请人身份自动执行开票", async () => expect(await canExecuteInvoice("u", "i")).toBe(false));
  it("全所开票执行只匹配已经批准的申请", async () => {
    db.user.findUnique.mockResolvedValue({ ...enabled, roleDefinition: { ...enabled.roleDefinition, permissions: [{ permissionKey: "invoices.process", scope: "ALL" }] } });
    expect(await canExecuteInvoice("u", "i")).toBe(true);
    expect(db.invoiceRequest.count).toHaveBeenCalledWith({ where: { id: "i", status: "APPROVED" } });
  });
  it("本人执行范围必须有关联案件经办关系", async () => {
    db.user.findUnique.mockResolvedValue({ ...enabled, roleDefinition: { ...enabled.roleDefinition, permissions: [{ permissionKey: "invoices.process", scope: "OWN" }] } });
    await canExecuteInvoice("u", "i"); expect(JSON.stringify(db.invoiceRequest.count.mock.calls[0])).toContain('"ownerId":"u"');
  });
});
