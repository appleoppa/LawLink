export type TeamColleague = { id: string; name: string; isTeammate?: boolean; active?: boolean };

/** Keep selected people visible during search; never select or deselect automatically. */
export function groupColleagues<T extends TeamColleague>(
  colleagues: T[], search: string, selectedIds: string[] = []
) {
  const query = search.trim().toLocaleLowerCase();
  const selected = new Set(selectedIds);
  const visible = [...new Map(colleagues.map((u) => [u.id, u])).values()]
    .filter((u) => selected.has(u.id) || (u.active !== false && u.name.toLocaleLowerCase().includes(query)));
  return [
    { label: "我的团队", people: visible.filter((u) => u.isTeammate) },
    { label: "全所其他人员", people: visible.filter((u) => !u.isTeammate) }
  ].filter((group) => group.people.length > 0);
}
