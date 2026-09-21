/**
 * Server Action 业务错误通道。
 *
 * 背景（2026-09-21 production 实测）：Next.js 生产构建下，server action 抛出的
 * Error 经 React Flight 序列化时 message 会被脱敏——客户端 catch 到的
 * err.message 是「Minified React error #441」占位符，而不是服务端写的中文提示。
 * digest 是唯一可靠到达客户端的错误文本通道（Next 官方 error boundary 同样依赖它）。
 *
 * 约定：
 * - 服务端「面向用户的业务校验失败」一律 `throw new ActionError("中文提示")`；
 *   ActionError 构造时把消息同时写入 digest，客户端经 actionErrorMessage 读取。
 * - 内部错误（编程缺陷、数据库异常等）继续 throw 原生 Error——保持生产脱敏，
 *   不向客户端泄漏内部细节。
 * - dev 模式下 message 本身可达，两种 Error 行为一致。
 */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
    // React Flight 在生产构建只透传 digest；把它设为业务消息本身。
    (this as Error & { digest?: string }).digest = `ACTION_ERROR:${message}`;
  }
}

import { ZodError } from "zod";

// ZodError 同样经 React Flight 脱敏（2026-09-21 生产实测：schema.parse 的校验失败
// 在客户端表现为 Minified React error #441）。zod 的 issue message 本仓库全部面向
// 用户（中文），把首条消息经 digest 通道透出；只影响 ZodError 原型，不碰其他 Error。
if (!("digest" in ZodError.prototype)) {
  Object.defineProperty(ZodError.prototype, "digest", {
    get(this: InstanceType<typeof ZodError>) {
      const msgs = this.issues.slice(0, 2).map(i => i.message).filter(Boolean);
      return `ACTION_ERROR:${msgs.join("；") || "输入信息有误，请检查后重试"}`;
    },
    configurable: true
  });
}

const ACTION_ERROR_PREFIX = "ACTION_ERROR:";

/** 提取面向用户的错误文案：优先 ActionError 的 digest 通道，退回 message。 */
export function actionErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const digest = (err as Error & { digest?: string }).digest;
    if (typeof digest === "string" && digest.startsWith(ACTION_ERROR_PREFIX)) {
      return digest.slice(ACTION_ERROR_PREFIX.length);
    }
    return err.message;
  }
  return err ? String(err) : "";
}
