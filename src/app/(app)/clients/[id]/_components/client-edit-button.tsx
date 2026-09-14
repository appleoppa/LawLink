"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { Client, Contact } from "@prisma/client";
import { ClientSheet } from "@/app/(app)/clients/_components/client-sheet";

/**
 * v0.39: 客户详情页「编辑信息」入口。
 * 详情页是服务端组件，这里包一层客户端 state 复用现有 ClientSheet（含编辑 + 联系人）。
 */
export function ClientEditButton({
  client
}: {
  client: Client & { contacts?: Contact[] };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-sm"
      >
        <Pencil />
        编辑资料
      </button>
      <ClientSheet open={open} onOpenChange={setOpen} editingClient={client} />
    </>
  );
}
