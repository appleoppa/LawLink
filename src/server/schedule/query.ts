import {Prisma} from "@prisma/client";
import {scopeFor} from "@/lib/roles/catalog";
import {responsibilityReady,closedHearingIds} from "@/server/reminders/responsibility";
/**
 * v0.50: 日程聚合查询（无 session 依赖的内部实现）。
 * 被 listScheduleItems（server action）和 ICS 日历订阅路由共用；
 * 调用方负责确定 userId / role 的可信来源（session 或 calendarToken）。
 */
import { resolveRoleUser } from "@/lib/roles/service";
import { customMatterFilter } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { shDayKey } from "@/lib/ui/sh-time";
import { matterAssociationFilter, matterReadVisibilityFilter } from "@/lib/permissions";

export type ScheduleItem = {
  id: string;
  type: "hearing" | "deadline" | "task";
  title: string;
  occurredAt: Date;
  matter: { id: string; internalCode: string; title: string };
  clientName: string | null;
  href?:string;
  procedureLabel?: string;
  completed?: boolean;
  remindDays?: number;
  category?: string;
  description?: string | null;
  priority?: number;
};

export async function queryScheduleItems(
  userId: string,
  // session.user.role 沿用 next-auth 的 string 类型（与 matterVisibilityFilter 一致）
  role: string,
  params: {
    from?: Date;
    to?: Date;
    includeCompleted?: boolean;
    onlyMine?: boolean;
    includeTeam?: boolean;
  } = {}
): Promise<ScheduleItem[]> {
  // 2026-09-20 第五轮审计时区修复：默认起点按上海今日零点（此前服务器本地午夜，
  // UTC 容器窗口整体偏 8 小时；当前调用方都显式传参，属防御性修正）
  const from = params.from ?? new Date(`${shDayKey(new Date())}T00:00:00+08:00`);
  const to = params.to ?? new Date(from.getTime() + 365 * 24 * 60 * 60 * 1000);
  const access = await resolveRoleUser(userId, role);
  if (!access.enabled) return [];
  // 内置角色统一走站内读取口径（P2-8）：日历订阅此前落旧版 matterVisibilityFilter，
  // FINANCE 被放大到全所案件日程；read 版同时携带 grants，管理权用户订阅与站内可见性一致。
  const matterFilter = role === "CUSTOM" ? { AND: [customMatterFilter(userId, access.rolePermissions, "schedule.read", !params.onlyMine), matterReadVisibilityFilter(userId, role, access.rolePermissions), ...(params.onlyMine ? [matterAssociationFilter(userId)] : [])] } : params.onlyMine
    ? matterAssociationFilter(userId)
    : matterReadVisibilityFilter(userId, role, access.rolePermissions);

  const excludedHearings=await closedHearingIds(prisma);
  const [hearings, deadlines, tasks, preservationProperties] = await Promise.all([
    prisma.hearing.findMany({
      where: {
        startsAt: { gte: from, lte: to },
        id:{notIn:excludedHearings},
        procedure: {
          engagement: "ENGAGED",
          matter: { deletedAt: null, ...matterFilter }
        }
      },
      include: {
        procedure: {
          select: {
            type: true,
            customLabel: true,
            matter: {
              select: {
                id: true,
                internalCode: true,
                title: true,
                primaryClient: { select: { name: true } },
                clientLinks: {
                  select: {
                    isPrimary: true,
                    client: { select: { name: true } }
                  },
                  orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }]
                }
              }
            }
          }
        }
      }
    }),
    prisma.deadline.findMany({
      where: {
        dueAt: { gte: from, lte: to },
        ...(params.includeCompleted ? {} : { completed: false }),
        procedure: {
          engagement: "ENGAGED",
          matter: { deletedAt: null, ...matterFilter }
        }
      },
      include: {
        procedure: {
          select: {
            type: true,
            customLabel: true,
            matter: {
              select: {
                id: true,
                internalCode: true,
                title: true,
                primaryClient: { select: { name: true } },
                clientLinks: {
                  select: {
                    isPrimary: true,
                    client: { select: { name: true } }
                  },
                  orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }]
                }
              }
            }
          }
        }
      }
    }),
    prisma.task.findMany({
      where: {
        dueAt: { gte: from, lte: to },
        ...(params.includeCompleted ? {} : { completed: false }),
        matter: { deletedAt: null, ...matterFilter }
      },
      include: {
        matter: {
          select: {
            id: true,
            internalCode: true,
            title: true,
            primaryClient: { select: { name: true } },
            clientLinks: {
              select: {
                isPrimary: true,
                client: { select: { name: true } }
              },
              orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }]
            }
          }
        }
      }
    }),
    prisma.preservationProperty.findMany({
      where: {
        expiryDate: { gte: from, lte: to },
        ...(params.includeCompleted ? {} : { status: { in: ["ACTIVE", "RENEWED"] } }),
        target: {
          case: {
            matter: { deletedAt: null, ...matterFilter }
          }
        }
      },
      include: {
        target: {
          include: {
            case: {
              include: {
                matter: {
                  select: {
                    id: true,
                    internalCode: true,
                    title: true,
                    primaryClient: { select: { name: true } },
                    clientLinks: {
                      select: {
                        isPrimary: true,
                        client: { select: { name: true } }
                      },
                      orderBy: [{ isPrimary: "desc" }, { addedAt: "asc" }]
                    }
                  }
                }
              }
            }
          }
        }
      }
    })
  ]);

  const items: ScheduleItem[] = [];
  const clientNameOf = (matter: {
    primaryClient: { name: string } | null;
    clientLinks: { isPrimary: boolean; client: { name: string } }[];
  }) =>
    matter.primaryClient?.name ??
    matter.clientLinks.find((link) => link.isPrimary)?.client.name ??
    matter.clientLinks[0]?.client.name ??
    null;
  const matterBrief = (matter: { id: string; internalCode: string; title: string }) => ({
    id: matter.id,
    internalCode: matter.internalCode,
    title: matter.title
  });

  for (const h of hearings) {
    const matter = h.procedure.matter;
    items.push({
      id: `h-${h.id}`,
      type: "hearing",
      title: h.title,
      occurredAt: h.startsAt,
      matter: matterBrief(matter),
      clientName: clientNameOf(matter),
      procedureLabel: h.procedure.customLabel ?? h.procedure.type
    });
  }
  for (const d of deadlines) {
    const matter = d.procedure.matter;
    items.push({
      id: `d-${d.id}`,
      type: "deadline",
      title: d.title,
      occurredAt: d.dueAt,
      matter: matterBrief(matter),
      clientName: clientNameOf(matter),
      procedureLabel: d.procedure.customLabel ?? d.procedure.type,
      completed: d.completed,
      remindDays: d.remindDays,
      category: d.category
    });
  }
  for (const t of tasks) {
    if (!t.dueAt) continue;
    items.push({
      id: `t-${t.id}`,
      type: "task",
      title: t.title,
      occurredAt: t.dueAt,
      matter: matterBrief(t.matter),
      clientName: clientNameOf(t.matter),
      completed: t.completed,
      description: t.description,
      priority: t.priority
    });
  }
  for (const p of preservationProperties) {
    const matter = p.target.case.matter;
    if (!matter) continue;
    items.push({
      id: `p-${p.id}`,
      type: "deadline",
      title: `保全到期：${p.target.name}`,
      occurredAt: p.expiryDate,
      matter: matterBrief(matter),
      clientName: clientNameOf(matter),
      procedureLabel: "财产保全",
      completed: p.status !== "ACTIVE" && p.status !== "RENEWED",
      remindDays: 30,
      category: "PRESERVATION"
    });
  }
  if(await responsibilityReady(prisma)&&(role!=='CUSTOM'||scopeFor(access,'schedule.read'))){
    const allowed=await prisma.matter.findMany({where:{deletedAt:null,...matterFilter},select:{id:true}});
    const ids=allowed.map(m=>m.id);
    const urgent=await prisma.$queryRaw<{id:string;title:string;dueAt:Date;kind:string;state:string;matterId:string|null;intakeId:string;caseTitle:string;code:string|null}[]>(Prisma.sql`SELECT w.id,w.title,w."dueAt",w.kind,w.state::text,w."matterId",w."intakeId",COALESCE(m.title,i.title) AS "caseTitle",m."internalCode" AS code FROM "IntakeUrgentItem" w JOIN "Intake" i ON i.id=w."intakeId" LEFT JOIN "Matter" m ON m.id=w."matterId" WHERE w."dueAt">=${from} AND w."dueAt"<=${to} AND w.state<>'CANCELLED' ${params.includeCompleted?Prisma.empty:Prisma.sql`AND w.state='OPEN'`} AND ((w."matterId" IS NULL AND (i."createdById"=${userId} OR i."ownerUserId"=${userId} OR ${userId}=ANY(i."coUserIds"))) ${ids.length?Prisma.sql`OR w."matterId" IN (${Prisma.join(ids)})`:Prisma.empty})`);
    for(const w of urgent)items.push({id:`u-${w.id}`,type:w.kind==='HEARING'?'hearing':w.kind==='DEADLINE'?'deadline':'task',title:w.title,occurredAt:w.dueAt,matter:{id:w.matterId??w.intakeId,internalCode:w.code??'收案',title:w.caseTitle},href:w.matterId?`/matters/${w.matterId}`:`/intakes/${w.intakeId}`,clientName:null,procedureLabel:'收案紧急事项',completed:w.state==='DONE'});
  }
  items.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  return items;
}
