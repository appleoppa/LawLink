import { z } from "zod";

export const teamInputSchema = z.object({
  id: z.string().cuid().optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
  name: z.string().trim().min(1, "请输入团队名称").max(60, "团队名称最多 60 字"),
  leaderId: z.string().cuid("请选择负责人"),
  active: z.boolean().default(true),
  members: z.array(z.object({
    userId: z.string().cuid(),
    canViewAllMatters: z.boolean().default(false)
  })).max(500)
}).superRefine((data, ctx) => {
  if (new Set(data.members.map((m) => m.userId)).size !== data.members.length) {
    ctx.addIssue({ code: "custom", path: ["members"], message: "团队成员不能重复" });
  }
  if (data.id && !data.expectedUpdatedAt) {
    ctx.addIssue({ code: "custom", path: ["expectedUpdatedAt"], message: "请刷新后再编辑团队" });
  }
});
export type TeamInput = z.input<typeof teamInputSchema>;
