"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { readAndValidateIdentityImage } from "@/lib/identity-documents";
import { approvalAudit } from "@/lib/approvals/service";
import { correctIdentitySchema } from "@/server/users/profile-schema";
import { assertProfileActor, assertProfileVersion, identitySummary, profileTransaction } from "@/server/users/profile-service";
import { storeIdentityDocumentFiles } from "./storage";
import { ActionError } from "@/lib/action-error";

export async function correctUserIdentityWithPhotos(formData: FormData) {
  const session = await requireSession();
  const data = correctIdentitySchema.parse({
    id: formData.get("id"),
    identityDocumentType: formData.get("identityDocumentType"),
    identityDocumentName: formData.get("identityDocumentName"),
    identityDocumentNumber: formData.get("identityDocumentNumber"),
    reason: formData.get("reason"),
    expectedUpdatedAt: formData.get("expectedUpdatedAt")
  });
  const files = [formData.get("identityImagePrimary"), formData.get("identityImageSecondary")]
    .filter((file): file is File => file instanceof File && file.size > 0);
  if (!files.length) throw new ActionError("请上传新的证件照片");
  for (const file of files) await readAndValidateIdentityImage(file);

  const result = await profileTransaction(async db => {
    await assertProfileActor(db, session.user.id, data.id, true);
    await assertProfileVersion(db, data.id, data.expectedUpdatedAt);
    const stored = await storeIdentityDocumentFiles({
      userId: data.id,
      uploadedById: session.user.id,
      documentType: data.identityDocumentType,
      files
    });
    const now = new Date();
    await db.userIdentityDocument.updateMany({ where: { userId: data.id, active: true }, data: { active: false, supersededAt: now } });
    await db.user.update({ where: { id: data.id, updatedAt: new Date(data.expectedUpdatedAt) }, data: {
      identityDocumentType: data.identityDocumentType,
      identityDocumentName: data.identityDocumentType === "OTHER" ? data.identityDocumentName : null,
      identityDocumentNumber: data.identityDocumentNumber
    }, select: { id: true } });
    await db.userIdentityDocument.createMany({ data: stored });
    await approvalAudit(db, session.user.id, "USER_IDENTITY_CORRECT_WITH_PHOTO", data.id, {
      fields: ["identityDocumentType", "identityDocumentNumber", "identityDocuments"],
      identityPhotoCount: stored.length,
      reason: data.reason
    });
    return identitySummary(db, data.id);
  });
  revalidatePath("/", "layout");
  return result;
}
