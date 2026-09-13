import { z } from "zod";

export const ARCHIVE_POLICY_SETTING_KEY = "archivePolicy";

export const archivePolicySchema = z.object({
  schemaVersion: z.literal(1),
  configured: z.literal(true),
  name: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(60),
  effectiveAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceFileId: z.string().cuid(),
  confirmedAt: z.string().datetime(),
  confirmedById: z.string().cuid()
});

export type ArchivePolicy = z.infer<typeof archivePolicySchema>;

export type ArchivePolicyView = {
  configured: boolean;
  name: string;
  version: string;
  effectiveAt: string;
  sourceFileId: string | null;
  sourceFileName: string | null;
  sourceFileSha256: string | null;
};

export const UNCONFIGURED_ARCHIVE_POLICY: ArchivePolicyView = {
  configured: false,
  name: "未配置律所归档制度",
  version: "—",
  effectiveAt: "",
  sourceFileId: null,
  sourceFileName: null,
  sourceFileSha256: null
};
