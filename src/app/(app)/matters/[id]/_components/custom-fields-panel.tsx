"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { CustomFieldDef } from "@prisma/client";
import { Pencil, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldGrid, FieldItem } from "@/components/patterns/moan";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { saveMatterCustomValues } from "@/server/custom-fields/actions";

type FieldDef = Pick<
  CustomFieldDef,
  "id" | "key" | "label" | "fieldType" | "options" | "required"
>;

export function CustomFieldsPanel({
  matterId,
  defs,
  values,
  canEdit
}: {
  matterId: string;
  defs: FieldDef[];
  values: Record<string, string>;
  canEdit: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  if (defs.length === 0) return null;

  return (
    <section className="card">
      <div className="panel-head">
        <div className="panel-title">
          <ListChecks className="ic" strokeWidth={1.8} />
          自定义信息
        </div>
        {canEdit && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditOpen(true)}>
            <Pencil />
            编辑
          </button>
        )}
      </div>
      <div className="panel-body">
        <FieldGrid cols={2}>
          {defs.map((d) => (
            <FieldItem key={d.id} label={d.label} mono={d.fieldType === "NUMBER" || d.fieldType === "DATE"}>
              {values[d.key]?.trim() ? values[d.key] : null}
            </FieldItem>
          ))}
        </FieldGrid>
      </div>

      {canEdit && (
        <EditDialog
          key={editOpen ? "open" : "closed"}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          matterId={matterId}
          defs={defs}
          values={values}
        />
      )}
    </section>
  );
}

function EditDialog({
  open,
  onClose,
  matterId,
  defs,
  values
}: {
  open: boolean;
  onClose: () => void;
  matterId: string;
  defs: FieldDef[];
  values: Record<string, string>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>({ ...values });
  const [pending, startTransition] = useTransition();

  function set(key: string, v: string) {
    setDraft((prev) => ({ ...prev, [key]: v }));
  }

  function submit() {
    startTransition(async () => {
      try {
        await saveMatterCustomValues(matterId, draft);
        toast.success("已保存");
        onClose();
        router.refresh();
      } catch (err) {
        toast.error("保存失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>编辑自定义信息</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {defs.map((d) => (
            <div key={d.id} className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {d.label}
                {d.required && <span className="ml-0.5 text-destructive">*</span>}
              </label>
              {d.fieldType === "SELECT" ? (
                <Select value={draft[d.key] ?? ""} onValueChange={(v) => set(d.key, v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {d.options.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={d.fieldType === "NUMBER" ? "number" : d.fieldType === "DATE" ? "date" : "text"}
                  value={draft[d.key] ?? ""}
                  onChange={(e) => set(d.key, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
