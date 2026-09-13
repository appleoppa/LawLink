"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { CustomFieldDef } from "@prisma/client";
import { Plus, Pencil, Trash2, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  createCustomFieldDef,
  updateCustomFieldDef,
  deleteCustomFieldDef,
  toggleCustomFieldDef
} from "@/server/custom-fields/actions";

const TYPE_LABEL: Record<CustomFieldDef["fieldType"], string> = {
  TEXT: "文本",
  NUMBER: "数字",
  DATE: "日期",
  SELECT: "下拉"
};

export function CustomFieldsView({ matterFields }: { matterFields: CustomFieldDef[] }) {
  const [editing, setEditing] = useState<CustomFieldDef | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete(id: string, label: string) {
    if (!confirm(`删除自定义字段「${label}」？已录入的对应值将不再显示。`)) return;
    startTransition(async () => {
      try {
        await deleteCustomFieldDef(id);
        toast.success("已删除");
      } catch (err) {
        toast.error("删除失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  function handleToggle(id: string, enabled: boolean) {
    startTransition(async () => {
      try {
        await toggleCustomFieldDef(id, enabled);
      } catch (err) {
        toast.error("操作失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <ListChecks className="h-4 w-4 text-primary" />
            案件自定义字段
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            为案件添加机构特有的字段，新建/编辑案件详情时填写。
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-1">
          <Plus className="h-4 w-4" />
          添加字段
        </Button>
      </header>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
              <th className="px-4 py-2 font-medium">字段名称</th>
              <th className="px-4 py-2 font-medium">类型</th>
              <th className="px-4 py-2 font-medium">必填</th>
              <th className="px-4 py-2 font-medium">选项值</th>
              <th className="px-4 py-2 font-medium">启用</th>
              <th className="px-4 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {matterFields.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  还没有自定义字段，点击右上角「添加字段」
                </td>
              </tr>
            ) : (
              matterFields.map((f) => (
                <tr key={f.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-foreground">{f.label}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{TYPE_LABEL[f.fieldType]}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{f.required ? "是" : "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {f.fieldType === "SELECT" && f.options.length > 0
                      ? f.options.join(" / ")
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <Switch
                      checked={f.enabled}
                      onCheckedChange={(v) => handleToggle(f.id, v)}
                      disabled={pending}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => setEditing(f)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={() => handleDelete(f.id, f.label)}
                        disabled={pending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <FieldFormDialog
        key={editing?.id ?? "create"}
        open={createOpen || !!editing}
        field={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function FieldFormDialog({
  open,
  field,
  onClose
}: {
  open: boolean;
  field: CustomFieldDef | null;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(field?.label ?? "");
  const [fieldType, setFieldType] = useState<CustomFieldDef["fieldType"]>(
    field?.fieldType ?? "TEXT"
  );
  const [required, setRequired] = useState(field?.required ?? false);
  const [optionsText, setOptionsText] = useState((field?.options ?? []).join("\n"));
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!label.trim()) {
      toast.warning("请填写字段名称");
      return;
    }
    const options =
      fieldType === "SELECT"
        ? optionsText
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    if (fieldType === "SELECT" && options.length === 0) {
      toast.warning("下拉类型请至少填写一个选项（每行一个）");
      return;
    }
    startTransition(async () => {
      try {
        if (field) {
          await updateCustomFieldDef({ id: field.id, label, fieldType, required, options });
        } else {
          await createCustomFieldDef({ entityType: "MATTER", label, fieldType, required, options });
        }
        toast.success(field ? "已更新" : "已添加");
        onClose();
      } catch (err) {
        toast.error("保存失败", { description: err instanceof Error ? err.message : "" });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{field ? "编辑字段" : "添加字段"}</DialogTitle>
          <DialogDescription>字段将出现在案件详情的「自定义信息」中。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">字段名称</label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如：内部承办编号" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">字段类型</label>
            <Select
              value={fieldType}
              onValueChange={(v) => setFieldType(v as CustomFieldDef["fieldType"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TEXT">文本</SelectItem>
                <SelectItem value="NUMBER">数字</SelectItem>
                <SelectItem value="DATE">日期</SelectItem>
                <SelectItem value="SELECT">下拉</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {fieldType === "SELECT" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">选项值（每行一个）</label>
              <textarea
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder={"选项一\n选项二"}
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={required} onCheckedChange={setRequired} />
            必填
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending}>
            {field ? "保存" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
