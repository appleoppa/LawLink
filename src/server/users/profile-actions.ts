"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { approvalAudit } from "@/lib/approvals/service";
import { myProfileSchema, bindIdentitySchema, correctIdentitySchema } from "./profile-schema";
import { ProfileInputError, assertProfileActor, assertProfileVersion, identitySummary, profileTransaction, saveBasicProfile, verifyProfilePassword } from "./profile-service";

function refreshProfiles() {
  revalidatePath("/", "layout");
}
export async function updateMyProfile(input: z.infer<typeof myProfileSchema>) {
  const session = await requireSession("personal");
  const parsed = myProfileSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const result = await saveBasicProfile(session.user.id, session.user.id, parsed.data, { admin: false, password: parsed.data.currentPassword });
  refreshProfiles();
  return result;
}
export async function getProfileIdentity(targetId?: string) {
  const session = await requireSession("personal");
  const id = targetId === undefined ? session.user.id : z.string().cuid().parse(targetId);
  return profileTransaction(async db => {
    await assertProfileActor(db, session.user.id, id);
    const summary = await identitySummary(db, id);
    // 证件号码直接明文展示，查看仍留痕
    if (summary.number) await approvalAudit(db, session.user.id, "USER_IDENTITY_VIEW", id);
    return summary;
  });
}
export async function bindMyIdentity(input: z.infer<typeof bindIdentitySchema>) {
  const session = await requireSession("personal");
  const parsed = bindIdentitySchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const data = parsed.data;
  const result = await profileTransaction(async db => {
    await assertProfileActor(db, session.user.id, session.user.id);
    await assertProfileVersion(db, session.user.id, data.expectedUpdatedAt);
    const user = await db.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { identityDocumentNumber: true } });
    if (user.identityDocumentNumber) throw new ProfileInputError("身份证件已登记，如需更正请联系管理员");
    await verifyProfilePassword(db, session.user.id, data.currentPassword);
    await db.user.update({ where: { id: session.user.id, AND: [{ identityDocumentNumber: null }], updatedAt: new Date(data.expectedUpdatedAt) }, data: {
      identityDocumentType: data.identityDocumentType,
      identityDocumentName: data.identityDocumentType === "OTHER" ? data.identityDocumentName : null,
      identityDocumentNumber: data.identityDocumentNumber
    }, select: { id: true } });
    await approvalAudit(db, session.user.id, "USER_IDENTITY_BIND_SELF", session.user.id, { fields: ["identityDocumentType", "identityDocumentNumber"] });
    return identitySummary(db, session.user.id);
  });
  refreshProfiles();
  return result;
}
export async function correctUserIdentity(input: z.infer<typeof correctIdentitySchema>) {
  const session = await requireSession();
  const parsed = correctIdentitySchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const data = parsed.data;
  const result = await profileTransaction(async db => {
    await assertProfileActor(db, session.user.id, data.id, true);
    await assertProfileVersion(db, data.id, data.expectedUpdatedAt);
    await db.user.update({ where: { id: data.id, updatedAt: new Date(data.expectedUpdatedAt) }, data: {
      identityDocumentType: data.identityDocumentType,
      identityDocumentName: data.identityDocumentType === "OTHER" ? data.identityDocumentName : null,
      identityDocumentNumber: data.identityDocumentNumber
    }, select: { id: true } });
    await approvalAudit(db, session.user.id, "USER_IDENTITY_CORRECT", data.id, { fields: ["identityDocumentType", "identityDocumentNumber"], reason: data.reason });
    return identitySummary(db, data.id);
  });
  refreshProfiles();
  return result;
}
