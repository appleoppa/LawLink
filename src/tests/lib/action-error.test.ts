import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ActionError, actionErrorMessage } from "@/lib/action-error";

describe("action-error 业务错误通道", () => {
  it("ActionError 的 digest 携带业务消息，actionErrorMessage 优先读取", () => {
    const e = new ActionError("此事项尚无可审批人员");
    expect((e as Error & { digest?: string }).digest).toBe("ACTION_ERROR:此事项尚无可审批人员");
    expect(actionErrorMessage(e)).toBe("此事项尚无可审批人员");
  });

  it("ZodError 的 digest 透出首条中文校验消息（生产脱敏下的用户可见通道）", () => {
    const schema = z.object({ sourceFileId: z.string().cuid("请选择制度原文") });
    let thrown: unknown;
    try { schema.parse({ sourceFileId: "" }); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(z.ZodError);
    expect((thrown as Error & { digest?: string }).digest).toBe("ACTION_ERROR:请选择制度原文");
    expect(actionErrorMessage(thrown)).toBe("请选择制度原文");
  });

  it("普通 Error 不带前缀 digest，actionErrorMessage 回退 message（内部错误保持脱敏语义）", () => {
    const e = new Error("internal detail");
    expect((e as Error & { digest?: string }).digest).toBeUndefined();
    expect(actionErrorMessage(e)).toBe("internal detail");
    expect(actionErrorMessage("str")).toBe("str");
    expect(actionErrorMessage(null)).toBe("");
  });
});
