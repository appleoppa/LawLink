import type { Prisma } from "@prisma/client";

type DecimalLike = { toString(): string };

export function decimalToNumber(value: DecimalLike | number) {
  return typeof value === "number" ? value : Number(value.toString());
}

export function nullableDecimalToNumber(value: DecimalLike | number | null | undefined) {
  return value === null || value === undefined ? null : decimalToNumber(value);
}

/**
 * server action 返回值里的 Prisma.Decimal 深度转 number 后的类型。
 * Date / 基本类型保持不变，数组与嵌套对象递归处理。
 */
export type Serialized<T> = T extends Prisma.Decimal
  ? number
  : T extends Date
    ? T
    : T extends Array<infer U>
      ? Serialized<U>[]
      : T extends object
        ? { [K in keyof T]: Serialized<T[K]> }
        : T;

// 按 decimal.js 内部结构（sign/exponent/digits）识别，避免在可能进入
// 客户端 bundle 的 lib 里引入 @prisma/client 运行时
function isDecimalValue(value: unknown): value is DecimalLike {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { s?: unknown; e?: unknown; d?: unknown };
  return v.s !== undefined && v.e !== undefined && v.d !== undefined;
}

/**
 * 深度遍历 server action 返回值，把所有 Prisma.Decimal 转成 number。
 * 用于 RSC/客户端序列化边界，替代各 action 手写的逐字段 map（漏一个
 * 字段就是运行时报错，typecheck 拦不住）。
 */
export function serializeDecimals<T>(value: T): Serialized<T> {
  if (isDecimalValue(value)) {
    return Number(value.toString()) as Serialized<T>;
  }
  if (value === null || typeof value !== "object") {
    return value as Serialized<T>;
  }
  if (value instanceof Date) {
    return value as Serialized<T>;
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeDecimals(item)) as Serialized<T>;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = serializeDecimals(item);
  }
  return out as Serialized<T>;
}
