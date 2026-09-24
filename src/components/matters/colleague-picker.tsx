"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { groupColleagues, type TeamColleague } from "@/lib/teams/colleagues";

export function ColleaguePicker({ people, selected, onChange, label = "搜索律师姓名" }: {
  people: TeamColleague[]; selected: string[]; onChange: (ids: string[]) => void; label?: string;
}) {
  const [search, setSearch] = useState("");
  const groups = groupColleagues(people, search, selected);
  return <div className="space-y-2">
    <Input aria-label={label} placeholder={label} value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-sm" />
    <div className="max-h-60 space-y-2 overflow-y-auto">
      {groups.map((group) => <fieldset key={group.label} className="space-y-1">
        <legend className="px-2 py-1 text-xs font-medium text-muted-foreground">{group.label}</legend>
        {group.people.map((u) => <label key={u.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
          <Checkbox checked={selected.includes(u.id)} onCheckedChange={(checked) => onChange(checked === true ? [...new Set([...selected, u.id])] : selected.filter((id) => id !== u.id))} />
          <span>{u.name}{u.active === false ? "（账号停用）" : ""}</span>
        </label>)}
      </fieldset>)}
      {groups.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">没有匹配的人员</p>}
    </div>
  </div>;
}
