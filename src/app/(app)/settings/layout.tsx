import { PageHeader } from "@/components/patterns/moan";

export default async function SettingsLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <PageHeader className="!mb-0" title="个人设置" sub="个人资料、登录安全与身份信息；修改联系方式不会影响历史案件归属。" />

      {/* 目前只有一个设置分区，不再单独占一列导航；新增分区时再恢复侧栏 */}
      <div className="max-w-[960px]">{children}</div>
    </div>
  );
}
