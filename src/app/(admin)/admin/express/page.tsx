import { getExpressSettingsPublic } from "@/server/express/actions";
import { ExpressSettingsForm } from "./_components/express-settings-form";
import { AdminPageHeader } from "@/components/layout/admin-page-header";

export default async function ExpressSettingsPage() {
  return (
    <div className="space-y-5">
      <AdminPageHeader title="快递接入" sub="配置快递鸟 / 快递100 物流查询；未配置时仍可登记快递，只是不能自动刷新物流。" />
      <ExpressSettingsForm initial={await getExpressSettingsPublic()} />
    </div>
  );
}
