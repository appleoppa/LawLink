import { customOrLegacy } from "@/lib/roles/catalog";
/**
 * v0.38: 制度规范独立页（律所文书里的 POLICY 分类，只列文件、不显分类筛选）
 * v0.44: 标题与上传按钮同行（不再 hideHeader，改用 headerTitle 覆盖）
 */
import { redirect } from "next/navigation";
import { BookText } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { listFirmFiles } from "@/server/firm-files/actions";
import { FirmFilesView } from "@/app/(app)/firm-resources/_components/firm-files-view";

export default async function PolicyPage({
  searchParams
}: {
  searchParams: { q?: string; includeOld?: string };
}) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const isManager =
    customOrLegacy(session.user, "firm-files.manage", session.user.role === "PRINCIPAL_LAWYER");

  const files = await listFirmFiles({
    category: "POLICY",
    search: searchParams.q?.trim(),
    includeSuperseded: searchParams.includeOld === "1"
  });

  return (
    <FirmFilesView
      files={files}
      canUpload={isManager}
      currentCategory="POLICY"
      currentSearch={searchParams.q ?? ""}
      includeSuperseded={searchParams.includeOld === "1"}
      basePath="/policy"
      hideCategoryNav
      headerTitle="制度规范"
      headerSubtitle={`全所制度文件（员工手册、保密协议、薪酬制度等）。${isManager ? "管理员可上传与版本替代" : "管理员上传"}`}
      headerIcon={<BookText className="h-5 w-5 text-primary" strokeWidth={1.8} />}
    />
  );
}
