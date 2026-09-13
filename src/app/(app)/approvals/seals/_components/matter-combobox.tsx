"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type MatterOption = {
  id: string;
  internalCode: string;
  title: string;
};

export function MatterCombobox({
  matters,
  value,
  onChange,
  placeholder = "搜索案件编号 / 名称"
}: {
  matters: MatterOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? matters.find((m) => m.id === value) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selected ? (
            <span className="flex flex-1 items-center gap-2 truncate">
              <span className="font-mono text-[11px] text-muted-foreground">
                {selected.internalCode}
              </span>
              <span className="truncate">{selected.title}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <div className="flex items-center gap-1">
            {selected && (
              <span
                role="button"
                tabIndex={0}
                aria-label="清空"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange("");
                  }
                }}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        portalled={false}
        className="w-[--radix-popover-trigger-width] p-0"
      >
        <Command>
          <CommandInput placeholder="输入编号或案件名片段..." />
          <CommandList>
            <CommandEmpty>未找到匹配案件</CommandEmpty>
            <CommandGroup>
              {matters.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`${m.internalCode} ${m.title}`}
                  onSelect={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5",
                      value === m.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {m.internalCode}
                  </span>
                  <span className="ml-2 truncate text-[13px]">{m.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
