import type { IdentityDocumentType, Prisma } from "@prisma/client";
import { encryptBuffer, sha256 } from "@/lib/storage/crypto";
import { storage } from "@/lib/storage";
import { identityPageKindsFor, readAndValidateIdentityImage } from "@/lib/identity-documents";

export async function storeIdentityDocumentFiles(input: {
  userId: string;
  uploadedById: string;
  documentType: IdentityDocumentType;
  files: File[];
}): Promise<Prisma.UserIdentityDocumentCreateManyInput[]> {
  if (input.files.length < 1 || input.files.length > 2) throw new Error("请上传1至2张证件照片");
  const pageKinds = identityPageKindsFor(input.documentType);
  const result: Prisma.UserIdentityDocumentCreateManyInput[] = [];
  for (const [index, file] of input.files.entries()) {
    const validated = await readAndValidateIdentityImage(file);
    const encrypted = encryptBuffer(validated.buffer);
    const path = await storage.writeFile(`user-identities/${input.userId}`, encrypted.ciphertext);
    result.push({
      userId: input.userId,
      pageKind: pageKinds[index] ?? "OTHER",
      path,
      mimeType: validated.mimeType,
      size: validated.buffer.length,
      sha256: sha256(validated.buffer),
      algorithm: encrypted.algorithm,
      iv: encrypted.iv.toString("base64"),
      authTag: encrypted.authTag.toString("base64"),
      uploadedById: input.uploadedById,
      active: true
    });
  }
  return result;
}
