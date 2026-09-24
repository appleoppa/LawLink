import Link from "next/link";

/** 业务区 404：记录不存在或当前账号无权查看（不区分两者，避免泄露记录是否存在） */
export default function AppNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card max-w-md px-8 py-10 text-center">
        <div className="font-mono text-[13px] text-[var(--t-faint)]">404</div>
        <h1 className="mt-2 text-[20px] font-bold text-[var(--t-primary)]">页面不存在或无权查看</h1>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--t-muted)]">
          该记录可能已被删除、链接有误，或当前账号没有查看权限。需要处理审批事项时，请从「审批」工作台进入。
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/" className="btn btn-primary btn-sm">返回工作台</Link>
          <Link href="/approvals" className="btn btn-secondary btn-sm">进入审批</Link>
        </div>
      </div>
    </div>
  );
}
