import { redirect } from "next/navigation";
export default async function SealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const params = new URLSearchParams({ type: "SEAL_APPROVE" });
  if (query.new === "1") {
    params.set("new", "seal");
    for (const key of ["draftDocId", "matterId", "documentTitle"]) {
      const value = query[key];
      if (typeof value === "string") params.set(key, value);
    }
  } else if (typeof query.id === "string") params.set("id", query.id);
  else params.set("tab", "mine");
  redirect("/approvals?" + params.toString());
}
