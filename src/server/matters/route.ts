import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { matterHref, normalizeMatterParam } from "@/lib/matters/route";

/**
 * 把详情页路由参数解析成案件主键。
 *
 * 不去猜参数形状（cuid 还是编号），直接让数据库同时匹配两者：
 * `internalCode` 有唯一索引，cuid 不含 `-`、编号必含，两者不可能撞，
 * 一次查询即可，也不用为 cuid 的具体格式（v1/v2）写正则。
 *
 * 返回 `internalCode` 供调用方判断是否需要重定向到规范地址。
 */
export async function resolveMatterRoute(
  param: string
): Promise<{ id: string; internalCode: string } | null> {
  const normalized = normalizeMatterParam(param);

  const matter = await prisma.matter.findFirst({
    where: {
      deletedAt: null,
      OR: [{ id: param }, { internalCode: normalized }]
    },
    select: { id: true, internalCode: true }
  });

  return matter;
}

/**
 * 只拿得到 matterId 时的详情页地址（通知 href 会落库，必须用稳定的编号）。
 */
export async function matterHrefById(matterId: string): Promise<string> {
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { internalCode: true }
  });
  return matterHref({ id: matterId, internalCode: matter?.internalCode ?? null });
}

/**
 * 让案件详情页的缓存失效。
 *
 * 详情页路由键是 `internalCode`，而各 server action 手里只有 matterId，
 * 直接 `revalidatePath(`/matters/${matterId}`)` 会打到一个不存在的路径、
 * 静默失效（表现为改完数据后回退仍看到旧内容，不报错）。
 * 统一走这里换算，避免每个 action 各自拼路径。
 */
export async function revalidateMatter(matterId: string | null | undefined): Promise<void> {
  if (!matterId) return;

  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { internalCode: true }
  });
  if (!matter) return;

  revalidatePath(`/matters/${encodeURIComponent(matter.internalCode)}`);
}
