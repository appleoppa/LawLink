export type SystemRoleUser = {
  systemRole?: string | null;
};

export function isSystemAdmin(user: SystemRoleUser | null | undefined): boolean {
  return user?.systemRole === "SUPER_ADMIN";
}

export function canEnterAdminWorkspace(
  user: (SystemRoleUser & { role?: string | null }) | null | undefined
): boolean {
  return isSystemAdmin(user) || user?.role === "PRINCIPAL_LAWYER";
}
