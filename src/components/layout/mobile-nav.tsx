"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { NavContent, type FirmBrand } from "./sidebar";

export function MobileNav({
  open,
  onOpenChange,
  firm,
  onOpenTools
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  firm: FirmBrand;
  onOpenTools?: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[248px] p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>导航菜单</SheetTitle>
        </SheetHeader>
        <div className="h-full" onClick={() => onOpenChange(false)}>
          <NavContent firm={firm} onOpenTools={onOpenTools} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
