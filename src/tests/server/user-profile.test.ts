import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const { db, session, compare } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() },
  session: { user: { id: "cprofile000000000000000001", role: "LAWYER" } }, compare: vi.fn()
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth/session", () => ({ requireSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { compare } }));
import { updateMyProfile, bindMyIdentity, correctUserIdentity, getProfileIdentity } from "@/server/users/profile-actions";
import { saveBasicProfile } from "@/server/users/profile-service";
import { idNumberSchema, basicProfileSchema, correctIdentitySchema } from "@/server/users/profile-schema";

const date = new Date("2026-09-06T00:00:00.000Z");
const version = date.toISOString();
const specimen = "11010519491231002X"; // 公开格式示例，仅用于内存测试，不写入用户数据。
const base = { name: "测试用户", email: "test@example.invalid", phone: "", expectedUpdatedAt: version };
const own = { id: session.user.id, active: true, role: "LAWYER", updatedAt: date, name: base.name, email: base.email, phone: null, identityDocumentType: null, identityDocumentName: null, identityDocumentNumber: null, identityDocuments: [], passwordHash: "test-only-hash", sessionVersion: 0 };
const residentIdentity = { identityDocumentType: "PRC_RESIDENT_ID" as const, identityDocumentName: "", identityDocumentNumber: specimen };
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async callback => callback(db));
  db.user.findUnique.mockResolvedValue({ ...own });
  db.user.findUniqueOrThrow.mockResolvedValue({ ...own });
  db.user.update.mockResolvedValue({ id: own.id });
  compare.mockResolvedValue(true);
});

describe("本人身份号码校验", () => {
  it("规范化首尾空白和小写 x", () => expect(idNumberSchema.parse(` ${specimen.toLowerCase()} `)).toBe(specimen));
  it.each(["", "123", "110105194912310021", "11010519990231002X", "11010520991231002X", "00000019491231002X"])("拒绝无效号码 %s", value => expect(idNumberSchema.safeParse(value).success).toBe(false));
  it("允许空手机号，拒绝无效手机号和邮箱", () => {
    expect(basicProfileSchema.safeParse(base).success).toBe(true);
    expect(basicProfileSchema.safeParse({ ...base, phone: "不是号码" }).success).toBe(false);
    expect(basicProfileSchema.safeParse({ ...base, email: "bad" }).success).toBe(false);
  });
  it("更正原因不能携带完整号码", () => {
    expect(correctIdentitySchema.safeParse({ id: own.id, ...residentIdentity, expectedUpdatedAt: version, reason: `身份证 ${specimen}` }).success).toBe(false);
    expect(correctIdentitySchema.safeParse({ id: own.id, ...residentIdentity, expectedUpdatedAt: version, reason: "核对原件更正录入错误" }).success).toBe(true);
  });
});

describe("个人基本资料与身份操作边界", () => {
  it("本人请求中伪造用户编号、角色和身份证字段不会写入", async () => {
    await updateMyProfile({ ...base, name: "新姓名", id: "another", role: "LAWYER", idNumber: specimen } as Parameters<typeof updateMyProfile>[0]);
    const args = db.user.update.mock.calls[0][0];
    expect(args.where.id).toBe(own.id);
    expect(args.data).not.toHaveProperty("role");
    expect(args.data).not.toHaveProperty("idNumber");
    expect(args.data).not.toHaveProperty("id");
  });
  it("修改邮箱验证密码并递增会话版本", async () => {
    const result = await updateMyProfile({ ...base, email: "new@example.invalid", currentPassword: "test-only-password" });
    expect(compare).toHaveBeenCalledWith("test-only-password", "test-only-hash");
    expect(result.emailChanged).toBe(true);
    expect(db.user.update.mock.calls[0][0].data.sessionVersion).toEqual({ increment: 1 });
  });
  it("邮箱修改未填或填错密码时不写入", async () => {
    await expect(updateMyProfile({ ...base, email: "new@example.invalid" })).rejects.toThrow("当前密码");
    compare.mockResolvedValue(false);
    await expect(updateMyProfile({ ...base, email: "new@example.invalid", currentPassword: "wrong" })).rejects.toThrow("当前密码");
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it("管理员从用户管理修改本人邮箱也不能跳过密码验证", async () => {
    db.user.findUnique.mockResolvedValue({ ...own, systemRole: "SUPER_ADMIN" });
    await expect(saveBasicProfile(own.id, own.id, { ...base, email: "new@example.invalid" }, { admin: true })).rejects.toThrow("当前密码");
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it("只改手机号不撤销会话，审计不含具体手机号", async () => {
    await updateMyProfile({ ...base, phone: "13800000000" });
    expect(compare).not.toHaveBeenCalled();
    expect(db.user.update.mock.calls[0][0].data).not.toHaveProperty("sessionVersion");
    expect(db.auditLog.create.mock.calls[0][0].data.detail).toEqual({ fields: ["phone"] });
  });
  it("不传手机号时保留原值", async () => {
    await updateMyProfile({ ...base, phone: undefined, name: "新姓名" });
    expect(db.user.update.mock.calls[0][0].data).not.toHaveProperty("phone");
  });
  it("停用账号和过期版本不能保存", async () => {
    db.user.findUnique.mockResolvedValue({ ...own, active: false });
    await expect(updateMyProfile({ ...base, name: "新姓名" })).rejects.toThrow("停用");
    db.user.findUnique.mockResolvedValue(own);
    await expect(updateMyProfile({ ...base, expectedUpdatedAt: "2026-09-05T00:00:00.000Z" })).rejects.toThrow("刷新");
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it("普通用户不能读取或更正他人身份", async () => {
    const other = "cprofile000000000000000002";
    await expect(getProfileIdentity(other)).rejects.toThrow("管理员");
    await expect(correctUserIdentity({ id: other, ...residentIdentity, reason: "核对原件更正", expectedUpdatedAt: version })).rejects.toThrow("管理员");
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it("普通用户不能通过管理员入口更正本人身份", async () => {
    await expect(correctUserIdentity({ id: own.id, ...residentIdentity, reason: "核对原件更正", expectedUpdatedAt: version })).rejects.toThrow("管理员");
    await expect(saveBasicProfile(own.id, own.id, { ...base, name: "新姓名" }, { admin: true })).rejects.toThrow("管理员");
  });
  it("首次登记验证密码并只写入身份证字段", async () => {
    await bindMyIdentity({ ...residentIdentity, currentPassword: "test-only-password", expectedUpdatedAt: version });
    expect(compare).toHaveBeenCalled();
    const args = db.user.update.mock.calls[0][0];
    expect(args.where.AND).toEqual([{ identityDocumentNumber: null }]);
    expect(args.data).toEqual({ identityDocumentType: "PRC_RESIDENT_ID", identityDocumentName: null, identityDocumentNumber: specimen });
    expect(JSON.stringify(db.auditLog.create.mock.calls)).not.toContain(specimen);
  });
  it("已绑定的号码不能再次自行登记", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ ...own, ...residentIdentity });
    await expect(bindMyIdentity({ ...residentIdentity, currentPassword: "test-only-password", expectedUpdatedAt: version })).rejects.toThrow("已登记");
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it("身份摘要直接返回号码，查看记录审计", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ ...own, ...residentIdentity });
    const result = await getProfileIdentity();
    expect(result.number).toBe(specimen);
    expect(db.auditLog.create.mock.calls[0][0].data.action).toBe("USER_IDENTITY_VIEW");
  });
  it("管理员更正记录原因，不修改其他用户关系", async () => {
    db.user.findUnique.mockResolvedValue({ ...own, systemRole: "SUPER_ADMIN" });
    await correctUserIdentity({ id: own.id, ...residentIdentity, reason: "核对原件更正", expectedUpdatedAt: version });
    expect(db.user.update.mock.calls[0][0].data).toEqual({ identityDocumentType: "PRC_RESIDENT_ID", identityDocumentName: null, identityDocumentNumber: specimen });
    expect(db.auditLog.create.mock.calls[0][0].data.detail.reason).toBe("核对原件更正");
  });
  it.each([["identityDocumentNumber", "证件号码"], ["email", "邮箱"]])("%s 唯一冲突给出脱敏中文反馈", async (field, message) => {
    db.user.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("sensitive raw database error", { code: "P2002", clientVersion: "5", meta: { target: [field] } }));
    await expect(updateMyProfile({ ...base, name: "新姓名" })).rejects.toThrow(message);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it("并发写冲突明确要求刷新，不报告保存成功", async () => {
    db.user.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "5" }));
    await expect(updateMyProfile({ ...base, name: "新姓名" })).rejects.toThrow("刷新");
  });
  it("审计失败拒绝整个事务，采用可串行化隔离", async () => {
    db.auditLog.create.mockRejectedValue(new Error("audit failed"));
    await expect(updateMyProfile({ ...base, name: "新姓名" })).rejects.toThrow("资料暂不可用");
    expect(db.$transaction.mock.calls[0][1].isolationLevel).toBe("Serializable");
  });
});
