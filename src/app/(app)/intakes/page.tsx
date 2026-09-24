import { redirect } from "next/navigation";

// v0.4: /intakes 列表已合并到 /matters?tab=intake，老链接重定向
export default function IntakesPage() {
  redirect("/matters?tab=intake");
}
