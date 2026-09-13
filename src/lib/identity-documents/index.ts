import { z } from "zod";

export const identityDocumentTypes = [
  "PRC_RESIDENT_ID",
  "HK_MACAO_TAIWAN_RESIDENCE_PERMIT",
  "PRC_HK_MACAO_TRAVEL_PERMIT",
  "HK_MACAO_MAINLAND_TRAVEL_PERMIT",
  "TAIWAN_MAINLAND_TRAVEL_PERMIT",
  "PASSPORT",
  "FOREIGN_PERMANENT_RESIDENT_ID",
  "OTHER"
] as const;

export const identityDocumentTypeSchema = z.enum(identityDocumentTypes);
export type IdentityDocumentTypeValue = z.infer<typeof identityDocumentTypeSchema>;

export const identityDocumentTypeLabel: Record<IdentityDocumentTypeValue, string> = {
  PRC_RESIDENT_ID: "中华人民共和国居民身份证",
  HK_MACAO_TAIWAN_RESIDENCE_PERMIT: "港澳台居民居住证",
  PRC_HK_MACAO_TRAVEL_PERMIT: "往来港澳通行证",
  HK_MACAO_MAINLAND_TRAVEL_PERMIT: "港澳居民来往内地通行证（回乡证）",
  TAIWAN_MAINLAND_TRAVEL_PERMIT: "台湾居民来往大陆通行证（台胞证）",
  PASSPORT: "护照",
  FOREIGN_PERMANENT_RESIDENT_ID: "外国人永久居留身份证",
  OTHER: "其他身份证件"
};

export const identityDocumentPageKinds = [
  "PORTRAIT_SIDE",
  "EMBLEM_SIDE",
  "DATA_PAGE",
  "SUPPLEMENTARY_PAGE",
  "OTHER"
] as const;

export type IdentityDocumentPageKindValue = typeof identityDocumentPageKinds[number];

export const IDENTITY_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IDENTITY_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function isResidentIdNumber(value: string) {
  if (!/^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dX]$/.test(value)) return false;
  const year = Number(value.slice(6, 10));
  const month = Number(value.slice(10, 12));
  const day = Number(value.slice(12, 14));
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day || birth > new Date()) return false;
  if (value.slice(14, 17) === "000") return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  return "10X98765432"[sum % 11] === value[17];
}

export function normalizeIdentityDocumentNumber(value: string) {
  return value.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");
}

export const identityDocumentInputSchema = z.object({
  identityDocumentType: identityDocumentTypeSchema,
  identityDocumentName: z.string().trim().max(60, "证件名称不能超过60字").optional().or(z.literal("")),
  identityDocumentNumber: z.string().transform(normalizeIdentityDocumentNumber)
}).superRefine((data, ctx) => {
  if (data.identityDocumentType === "OTHER" && !data.identityDocumentName) {
    ctx.addIssue({ code: "custom", path: ["identityDocumentName"], message: "请填写证件名称" });
  }
  if (data.identityDocumentType !== "OTHER" && data.identityDocumentName) {
    ctx.addIssue({ code: "custom", path: ["identityDocumentName"], message: "该证件类型无需填写其他名称" });
  }
  if (["PRC_RESIDENT_ID", "HK_MACAO_TAIWAN_RESIDENCE_PERMIT"].includes(data.identityDocumentType)) {
    if (!isResidentIdNumber(data.identityDocumentNumber)) {
      ctx.addIssue({ code: "custom", path: ["identityDocumentNumber"], message: "请输入有效的18位居民身份号码" });
    }
  } else if (data.identityDocumentType === "OTHER") {
    if (!/^[\p{L}\p{N}./-]{5,50}$/u.test(data.identityDocumentNumber)) {
      ctx.addIssue({ code: "custom", path: ["identityDocumentNumber"], message: "证件号码应为5至50位字母、数字或常用分隔符" });
    }
  } else if (!/^[A-Z0-9]{5,50}$/.test(data.identityDocumentNumber)) {
    ctx.addIssue({ code: "custom", path: ["identityDocumentNumber"], message: "证件号码应为5至50位大写字母或数字" });
  }
});

export function maskIdentityDocument(value: string | null) {
  if (!value) return null;
  if (value.length <= 7) return `${value.slice(0, 1)}${"*".repeat(Math.max(1, value.length - 2))}${value.slice(-1)}`;
  return `${value.slice(0, 3)}${"*".repeat(Math.max(4, value.length - 7))}${value.slice(-4)}`;
}

export function identityPageKindsFor(type: IdentityDocumentTypeValue): [IdentityDocumentPageKindValue, IdentityDocumentPageKindValue] {
  return ["PRC_RESIDENT_ID", "HK_MACAO_TAIWAN_RESIDENCE_PERMIT", "FOREIGN_PERMANENT_RESIDENT_ID"].includes(type)
    ? ["PORTRAIT_SIDE", "EMBLEM_SIDE"]
    : ["DATA_PAGE", "SUPPLEMENTARY_PAGE"];
}

function detectImageMime(buffer: Buffer): typeof IDENTITY_IMAGE_MIME_TYPES[number] | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function readAndValidateIdentityImage(file: File) {
  if (!file.size) throw new Error("证件照片不能为空");
  if (file.size > IDENTITY_IMAGE_MAX_BYTES) throw new Error("单张证件照片不能超过10MB");
  const buffer = Buffer.from(await file.arrayBuffer());
  const detectedMime = detectImageMime(buffer);
  if (!detectedMime) throw new Error("证件照片仅支持 JPG、PNG 或 WebP");
  if (file.type && file.type !== detectedMime && !(file.type === "image/jpg" && detectedMime === "image/jpeg")) {
    throw new Error("证件照片格式与文件内容不一致");
  }
  const extension = file.name.toLowerCase().split(".").pop();
  const allowedExtensions = detectedMime === "image/jpeg" ? ["jpg", "jpeg"] : [detectedMime.split("/")[1]];
  if (!extension || !allowedExtensions.includes(extension)) throw new Error("证件照片扩展名与文件内容不一致");
  return { buffer, mimeType: detectedMime };
}
