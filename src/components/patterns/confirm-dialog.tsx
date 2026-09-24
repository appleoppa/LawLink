"use client";

/**
 * 全局确认 / 输入弹窗（替代浏览器原生 confirm / prompt）。
 * 用法：`if (!(await confirmDialog({ title, description, danger: true }))) return;`
 *      `const note = await promptDialog({ title, label, required: false });`（取消返回 null）
 * <ConfirmHost /> 挂在 Providers 中，全站唯一实例；模块级队列保证同一时刻只显示一个。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type BaseOptions = {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作：确认按钮用红色 */
  danger?: boolean;
};
export type ConfirmOptions = BaseOptions;
export type PromptOptions = BaseOptions & { label?: string; placeholder?: string; defaultValue?: string; required?: boolean; maxLength?: number };

type Request =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };

let current: Request | null = null;
const queue: Request[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(req: Request) {
  if (current) queue.push(req);
  else current = req;
  emit();
}
function settle() {
  current = queue.shift() ?? null;
  emit();
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => push({ kind: "confirm", opts, resolve }));
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => push({ kind: "prompt", opts, resolve }));
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function ConfirmHost() {
  const req = useSyncExternalStore(subscribe, () => current, () => null);
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (req?.kind === "prompt") {
      setValue(req.opts.defaultValue ?? "");
      setTouched(false);
    }
  }, [req]);

  if (!req) return null;
  const { opts } = req;
  const promptReq = req.kind === "prompt" ? req : null;
  const invalid = Boolean(promptReq?.opts.required && !value.trim());

  function close(ok: boolean) {
    if (!req) return;
    if (req.kind === "confirm") req.resolve(ok);
    else {
      if (ok && invalid) {
        setTouched(true);
        inputRef.current?.focus();
        return;
      }
      req.resolve(ok ? value.trim() : null);
    }
    settle();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(false); }}>
      <DialogContent className="max-w-md" onOpenAutoFocus={(e) => { if (promptReq) { e.preventDefault(); inputRef.current?.focus(); } }}>
        <DialogHeader className={promptReq ? undefined : "border-b-0 pb-0"}>
          <DialogTitle>{opts.title}</DialogTitle>
          {opts.description ? <DialogDescription className="whitespace-pre-line">{opts.description}</DialogDescription> : null}
        </DialogHeader>
        {promptReq ? (
          <div className="space-y-1.5">
            {promptReq.opts.label ? (
              <label className="text-[12.5px] font-medium text-[var(--t-secondary)]">
                {promptReq.opts.label}
                {promptReq.opts.required ? <span className="text-[var(--red)]"> *</span> : null}
              </label>
            ) : null}
            <Textarea
              ref={inputRef}
              rows={3}
              value={value}
              maxLength={promptReq.opts.maxLength ?? 500}
              placeholder={promptReq.opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) close(true); }}
            />
            {touched && invalid ? <div className="text-[11.5px] text-[var(--red)]">请填写{promptReq.opts.label ?? "内容"}</div> : null}
          </div>
        ) : null}
        <DialogFooter className={promptReq ? undefined : "border-t-0 pt-1"}>
          <button type="button" className="btn btn-secondary" onClick={() => close(false)}>{opts.cancelText ?? "取消"}</button>
          <button type="button" className={opts.danger ? "btn btn-danger" : "btn btn-primary"} onClick={() => close(true)} autoFocus={!promptReq}>
            {opts.confirmText ?? "确认"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
