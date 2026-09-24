"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/** 保留原生文件控件的选择、校验和表单语义，仅用中文替换可见提示。 */
const FileInput = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, onChange, disabled, ...props }, forwardedRef) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null)
    const descriptionId = React.useId()
    const [names, setNames] = React.useState<string[]>([])
    const summary = names.length ? names.join("、") : "未选择文件"

    React.useEffect(() => {
      const input = inputRef.current
      if (!input) return
      const form = input.form
      const cancel = () => setNames(Array.from(input.files ?? [], file => file.name))
      const reset = (event: Event) => {
        queueMicrotask(() => { if (!event.defaultPrevented) setNames([]) })
      }
      input.addEventListener("cancel", cancel)
      form?.addEventListener("reset", reset)
      return () => {
        input.removeEventListener("cancel", cancel)
        form?.removeEventListener("reset", reset)
      }
    }, [props.form])

    return (
      <span className={cn(
        "ll-form-control relative flex h-[34px] w-full min-w-0 items-center gap-3 rounded-[8px] border border-input px-[11px] py-1.5 text-[13px] ring-offset-background focus-within:border-[var(--teal)] focus-within:shadow-[0_0_0_3px_rgba(0,123,127,0.12)]",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}>
        <input
          {...props}
          type="file"
          disabled={disabled}
          title={props.title ?? summary}
          aria-describedby={[props["aria-describedby"], descriptionId].filter(Boolean).join(" ")}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          ref={node => {
            inputRef.current = node
            if (typeof forwardedRef === "function") forwardedRef(node)
            else if (forwardedRef) forwardedRef.current = node
          }}
          onChange={event => {
            onChange?.(event)
            setNames(Array.from(event.currentTarget.files ?? [], file => file.name))
          }}
        />
        <span aria-hidden="true" className="shrink-0 font-medium text-foreground">选择文件</span>
        <span id={descriptionId} aria-hidden="true" className="truncate text-muted-foreground">{summary}</span>
      </span>
    )
  }
)
FileInput.displayName = "FileInput"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    if (type === "file") return <FileInput {...props} className={className} ref={ref} />
    return (
      <input
        type={type}
        className={cn(
          "ll-form-control flex h-[34px] w-full rounded-[8px] border border-input px-[11px] py-1.5 text-[13px] ring-offset-background file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-foreground placeholder:text-[var(--t-faint)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
