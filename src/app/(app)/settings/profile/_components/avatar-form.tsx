"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveMyAvatar } from "@/server/users/actions";

const AVATAR_MAX_BYTES = 180 * 1024;

export function AvatarForm({ name, initialAvatar }: { name: string; initialAvatar: string | null }) {
  const router = useRouter();
  const [avatar, setAvatar] = useState<string | null>(initialAvatar);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const initial = name ? name.charAt(0) : "?";

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast.error("请选择图片文件（PNG / JPG / WebP / SVG）");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error("头像过大，请控制在约 180KB 以内");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAvatar(dataUrl);
      save(dataUrl);
    };
    reader.onerror = () => toast.error("读取图片失败");
    reader.readAsDataURL(file);
  };

  const save = (value: string | null) => {
    startTransition(async () => {
      try {
        await saveMyAvatar({ avatar: value });
        toast.success(value ? "头像已更新" : "头像已清除");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "保存失败");
      }
    });
  };

  return (
    <div className="flex items-center gap-4">
      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-border bg-primary/10">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-2xl font-semibold text-primary">{initial}</span>
        )}
      </div>
      <div className="space-y-1.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[12px] hover:bg-muted/60 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageUp className="h-3 w-3" />}
            上传头像
          </button>
          {avatar && (
            <button
              type="button"
              onClick={() => {
                setAvatar(null);
                if (fileRef.current) fileRef.current.value = "";
                save(null);
              }}
              disabled={pending}
              className="inline-flex items-center gap-1 text-[12px] text-destructive hover:underline disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              清除
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          未上传时显示姓名首字「{initial}」。建议方形图片，≤ 180KB。
        </p>
      </div>
    </div>
  );
}
