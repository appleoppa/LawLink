"use server";

import { requireSession } from "@/lib/auth/session";
import { queryScheduleItems } from "./query";

export async function listScheduleItems(params: {
  from?: Date;
  to?: Date;
  includeCompleted?: boolean;
  onlyMine?: boolean;
} = {}) {
  const session = await requireSession();
  return queryScheduleItems(session.user.id, session.user.role, params);
}
