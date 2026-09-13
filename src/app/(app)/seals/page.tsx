import { redirect } from "next/navigation";

// v0.8.1：/seals 重命名为 /approvals/seals，保留 308 重定向给旧链接
export default function LegacySealsRedirect() {
  redirect("/approvals/seals");
}
