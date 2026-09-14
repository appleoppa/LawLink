"use client";

import { useState } from "react";
import { Clock3 } from "lucide-react";
import { ConflictDialog } from "@/components/conflict-dialog";

/** v0.43：工作台问候栏的「利益冲突预检」入口（原在 HeroBlock，重构后保留） */
export function ConflictSearchButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary" title="快速了解本所是否有相关记录；不出结论，正式检索在登记收案时进行">
        <Clock3 strokeWidth={1.8} />
        冲突预检
      </button>
      <ConflictDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
