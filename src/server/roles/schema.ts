import { z } from "zod";
import { BUILTIN_ROLES, PERMISSIONS } from "@/lib/roles/catalog";
import { normalizeRoleName } from "@/lib/roles/catalog";
export { normalizeRoleName };
export const roleDefinitionSchema = z.object({
  id: z.string().cuid().optional(),
  version: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "请填写角色名称").max(60, "角色名称最多60字").refine(n => !BUILTIN_ROLES.some(r => normalizeRoleName(r.name) === normalizeRoleName(n) || r.id.toLowerCase() === normalizeRoleName(n)), "不能使用系统内置角色名称"),
  description: z.string().trim().max(300, "职责说明最多300字").default(""),
  active: z.boolean(),
  permissions: z.array(z.object({ permissionKey: z.string(), scope: z.enum(["OWN", "TEAM", "ALL"]) })).max(PERMISSIONS.length)
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      for (const row of rows) {
        const definition = PERMISSIONS.find(p => p.key === row.permissionKey);
        if (!definition || !(definition.scopes as readonly string[]).includes(row.scope) || seen.has(row.permissionKey)) ctx.addIssue({ code: "custom", message: "权限项目或数据范围无效，或重复选择" });
        seen.add(row.permissionKey);
      }
    }),
}).superRefine((data, ctx) => { if (data.id && !data.version) ctx.addIssue({ code: "custom", message: "缺少角色版本，请刷新后再保存" }); });
export type RoleDefinitionInput = z.infer<typeof roleDefinitionSchema>;

export const builtinRolePresentationSchema = z.object({
  id: z.string().refine(id => BUILTIN_ROLES.some(role => role.id === id), "无效的内置角色"),
  name: z.string().trim().min(1, "请填写角色名称").max(60, "角色名称最多60字"),
  description: z.string().trim().max(300, "介绍最多300字"),
  version: z.number().int().nonnegative(),
}).strict();
export type BuiltinRolePresentationInput = z.infer<typeof builtinRolePresentationSchema>;
