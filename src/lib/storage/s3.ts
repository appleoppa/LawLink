/**
 * S3-compatible storage provider (v0.17 完整实现).
 *
 * 启用方式：在 .env 设置 STORAGE_PROVIDER=s3，并提供：
 *   - AWS_REGION（必填，例 ap-northeast-1）
 *   - S3_BUCKET（必填）
 *   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY（IAM key 必填；或用其他 AWS 凭证机制）
 *   - S3_ENDPOINT（可选，自建 S3 兼容存储如 MinIO/R2）
 *   - S3_FORCE_PATH_STYLE（可选，true 用 path-style；MinIO 必须 true）
 *   - S3_KEY_PREFIX（可选，所有对象 key 前加此前缀，便于多环境共用同 bucket）
 */
import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type S3ClientConfig
} from "@aws-sdk/client-s3";
import type { StorageProvider } from "./provider";
import { ActionError } from "@/lib/action-error";

function readBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new ActionError("S3_BUCKET 未配置");
  return bucket;
}

function readRegion(): string {
  const region = process.env.AWS_REGION;
  if (!region) throw new ActionError("AWS_REGION 未配置");
  return region;
}

function readKeyPrefix(): string {
  const p = process.env.S3_KEY_PREFIX ?? "";
  if (!p) return "";
  return p.endsWith("/") ? p : `${p}/`;
}

function buildClient(): S3Client {
  const config: S3ClientConfig = {
    region: readRegion()
  };
  if (process.env.S3_ENDPOINT) {
    config.endpoint = process.env.S3_ENDPOINT;
  }
  if (process.env.S3_FORCE_PATH_STYLE === "true") {
    config.forcePathStyle = true;
  }
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    };
  }
  return new S3Client(config);
}

/**
 * AWS SDK 把对象 body 当成 ReadableStream / SDK stream-like 对象返回；统一吸成 Buffer。
 */
async function streamToBuffer(stream: unknown): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  if (Buffer.isBuffer(stream)) return stream;

  const maybeSdk = stream as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof maybeSdk.transformToByteArray === "function") {
    const arr = await maybeSdk.transformToByteArray();
    return Buffer.from(arr);
  }

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const s = stream as NodeJS.ReadableStream;
    s.on("data", (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    s.on("end", () => resolve(Buffer.concat(chunks)));
    s.on("error", reject);
  });
}

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor() {
    this.client = buildClient();
    this.bucket = readBucket();
    this.prefix = readKeyPrefix();
  }

  /**
   * 对象 key 结构：<prefix>/<scope>/<yyyymm>/<uuid>.bin
   * 与 LocalStorageProvider 保持同样的 layout，便于 local ↔ s3 迁移。
   * 数据库里仅存 relPath（不含 prefix），切换 prefix 时无需回填。
   */
  async writeFile(scope: string, data: Buffer): Promise<string> {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const safeScope = scope.split("/").filter(Boolean).map(part => part.replace(/[^a-zA-Z0-9_-]/g, "_")).join("/");
    if (!safeScope) throw new ActionError("存储范围不能为空");
    const relPath = `${safeScope}/${yyyymm}/${randomUUID()}.bin`;
    const key = this.prefix + relPath;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: "application/octet-stream"
      })
    );

    return relPath;
  }

  async readFile(relPath: string): Promise<Buffer> {
    const key = this.prefix + relPath;
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    return streamToBuffer(res.Body);
  }

  async deleteFile(relPath: string): Promise<void> {
    const key = this.prefix + relPath;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
      );
    } catch (err) {
      const code =
        (err as { name?: string }).name ?? (err as { Code?: string }).Code;
      if (code === "NoSuchKey" || code === "NotFound") return;
      throw err;
    }
  }
}
