// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, session, requireAdmin } = vi.hoisted(() => ({ session: { user: { id: "admin", role: "LAWYER", systemRole: "SUPER_ADMIN" } }, requireAdmin: vi.fn(), db: {
  user: { findUnique: vi.fn(), updateMany: vi.fn() }, systemSetting: { findUnique: vi.fn(), upsert: vi.fn() }, roleDefinition: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  rolePermission: { deleteMany: vi.fn(), createMany: vi.fn() }, auditLog: { create: vi.fn() },
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSystemAdmin: requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/approvals/service", () => ({ approvalTransaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db) }));
import { saveRoleDefinition, saveBuiltinRolePresentation } from "@/server/roles/actions";
const id = "cmrolescustomverification1";
const values = { name: "档案专员", description: "", active: true, permissions: [{ permissionKey: "express.manage", scope: "OWN" as const }] };
beforeEach(() => { vi.resetAllMocks(); requireAdmin.mockResolvedValue(session); db.user.findUnique.mockResolvedValue({ systemRole: "SUPER_ADMIN", active: true }); db.user.updateMany.mockResolvedValue({ count: 2 }); db.roleDefinition.create.mockResolvedValue({ id }); db.roleDefinition.update.mockResolvedValue({ id }); });
describe("角色管理授权、并发和审计", () => {
  it("普通角色不能新增或改角色", async () => { requireAdmin.mockRejectedValueOnce(new Error("仅系统超级管理员可以执行此操作")); await expect(saveRoleDefinition(values)).rejects.toThrow("超级管理员"); expect(db.roleDefinition.create).not.toHaveBeenCalled(); });
  it("管理员在事务开始前被撤权则不保存", async () => { db.user.findUnique.mockResolvedValue({ systemRole: "NONE", active: true }); await expect(saveRoleDefinition(values)).rejects.toThrow("已失效"); expect(db.rolePermission.deleteMany).not.toHaveBeenCalled(); });
  it("新角色与固定权限配置同事务保存，审计只含配置和影响人数", async () => { await saveRoleDefinition(values); expect(db.roleDefinition.create).toHaveBeenCalledWith({ data: { name: "档案专员", normalizedName: "档案专员", description: "", active: true } }); expect(db.rolePermission.createMany).toHaveBeenCalledWith({ data: [{ roleId: id, permissionKey: "express.manage", scope: "OWN" }] }); expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "ROLE_DEFINITION_SAVE", targetId: id, detail: expect.objectContaining({ affectedUsers: 2 }) }) })); });
  it("版本不一致时不替换权限，也不撤销任何人的会话", async () => { db.roleDefinition.findUnique.mockResolvedValue({ id, version: 3 }); await expect(saveRoleDefinition({ ...values, id, version: 2 })).rejects.toThrow("已变化"); expect(db.rolePermission.deleteMany).not.toHaveBeenCalled(); expect(db.user.updateMany).not.toHaveBeenCalled(); });
  it("停用角色保留账号与关联，同时撤销旧会话", async () => { db.roleDefinition.findUnique.mockResolvedValue({ id, version: 2, name: "档案专员", active: true, permissions: [] }); await saveRoleDefinition({ ...values, id, version: 2, active: false }); expect(db.roleDefinition.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ active: false, version: { increment: 1 } }) })); expect(db.user.updateMany).toHaveBeenCalledWith({ where: { role: "CUSTOM", roleDefinitionId: id }, data: { sessionVersion: { increment: 1 } } }); });
});

const builtinInput = { id: "LAWYER", name: "执业律师", description: "负责本人经办案件", version: 0 };
describe("内置角色显示资料与权限分离", () => {
  it("行政固定标识不能通过自定义接口改权限或停用", async () => {
    await expect(saveRoleDefinition({ ...values, id: "cmrolesadministrative00001", version: 1, active: false })).rejects.toThrow("只能修改名称和介绍");
    expect(db.roleDefinition.update).not.toHaveBeenCalled();
  });
  it("管理员可改名并审计，不动权限、账号或会话", async () => {
    await saveBuiltinRolePresentation(builtinInput);
    expect(db.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: expect.objectContaining({ LAWYER: { name: "执业律师", description: "负责本人经办案件", version: 1 } }) } }));
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "BUILTIN_ROLE_PRESENTATION_UPDATE", targetId: "LAWYER" }) }));
    expect(db.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
  it("行政只更新显示字段，不写权限或启用状态", async () => {
    db.roleDefinition.findUnique.mockResolvedValue({ name: "行政", description: "旧介绍", version: 2 });
    await saveBuiltinRolePresentation({ id: "cmrolesadministrative00001", name: "行政人员", description: "日常事务", version: 2 });
    expect(db.roleDefinition.update).toHaveBeenCalledWith({ where: { id: "cmrolesadministrative00001", version: 2 }, data: { name: "行政人员", description: "日常事务", normalizedName: "行政人员", version: 3 } });
    expect(db.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
  it("拒绝冒用另一个内置角色名称", async () => {
    await expect(saveBuiltinRolePresentation({ ...builtinInput, name: "主办律师" })).rejects.toThrow("已被内置角色使用");
  });
  it("拒绝与已有自定义角色重名", async () => {
    db.roleDefinition.findFirst.mockResolvedValue({ id });
    await expect(saveBuiltinRolePresentation(builtinInput)).rejects.toThrow("名称已存在");
    expect(db.systemSetting.upsert).not.toHaveBeenCalled();
  });
  it("改名后的内置名称也不能被新建自定义角色使用", async () => {
    db.systemSetting.findUnique.mockResolvedValue({ value: { LAWYER: { name: "执业律师", description: "", version: 1 } } });
    await expect(saveRoleDefinition({ ...values, name: "执业律师" })).rejects.toThrow("已被内置角色使用");
  });
  it("陈旧版本不能覆盖资料", async () => {
    db.systemSetting.findUnique.mockResolvedValue({ value: { LAWYER: { name: "执业律师", description: "", version: 1 } } });
    await expect(saveBuiltinRolePresentation(builtinInput)).rejects.toThrow("已变化");
    expect(db.systemSetting.upsert).not.toHaveBeenCalled();
  });
  it("普通用户与事务内撤权的管理员均不能保存", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("仅系统超级管理员可以执行此操作"));
    await expect(saveBuiltinRolePresentation(builtinInput)).rejects.toThrow("超级管理员");
    db.user.findUnique.mockResolvedValue({ systemRole: "NONE", active: true });
    await expect(saveBuiltinRolePresentation(builtinInput)).rejects.toThrow("已失效");
  });
  it("拒绝把权限和启停字段塞进显示资料接口", async () => {
    await expect(saveBuiltinRolePresentation({ ...builtinInput, active: false } as typeof builtinInput)).rejects.toThrow();
    expect(db.systemSetting.upsert).not.toHaveBeenCalled();
  });
});
