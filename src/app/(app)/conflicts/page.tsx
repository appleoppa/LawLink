import { ConflictsViewV4 } from "./_components/conflicts-view-v4";

/**
 * 工作区「冲突预检」：只做自查，不挂收案、不出结论。
 * 收案的正式检索在收案向导 / 收案详情中进行（2026-09-14 用户确认，原 ?intakeId= 入口取消）。
 */
export default async function ConflictsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const prefillName = typeof params.name === "string" ? params.name.slice(0, 100) : "";
  return <ConflictsViewV4 prefillName={prefillName} />;
}
