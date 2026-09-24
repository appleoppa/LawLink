export type SystemRoleUser = {
  systemRole?: string | null;
};

export function isSystemAdmin(user: SystemRoleUser | null | undefined): boolean {
  return user?.systemRole === "SUPER_ADMIN";
}

export function canEnterAdminWorkspace(
  user: (SystemRoleUser & { role?: string | null; managerAuthorized?: boolean | null }) | null | undefined
): boolean {
  // 合伙人与获业务管理权者保留提醒维护、批量导入等后台资格（2026-09-06 保留项）
  return isSystemAdmin(user) || user?.role === "PRINCIPAL_LAWYER" || user?.managerAuthorized === true;
}
