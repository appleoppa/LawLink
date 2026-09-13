import { getExpressSettingsPublic } from "@/server/express/actions";
import { ExpressSettingsForm } from "./_components/express-settings-form";

export default async function ExpressSettingsPage() {
  return <ExpressSettingsForm initial={await getExpressSettingsPublic()} />;
}
