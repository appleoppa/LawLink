import { describe, expect, it } from "vitest";
import { parseSms } from "@/lib/sms-parser";

describe("parseSms", () => {
  it("提取开庭时间并生成重要事项", () => {
    const parsed = parseSms(
      "【上海市浦东新区人民法院】案号（2026）沪0115民初12345号，本院定于2026年7月1日上午9:30在第三法庭开庭，承办法官张三。"
    );

    expect(parsed.smsType).toBe("HEARING_NOTICE");
    expect(parsed.caseNumbers).toEqual(["（2026）沪0115民初12345号"]);
    expect(parsed.hearingDate).toBe("2026年7月1日上午9:30");
    expect(parsed.dates).toEqual(["2026年7月1日上午9:30"]);
    expect(parsed.importantItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "HEARING",
          title: "开庭 / 庭审",
          dateText: "2026年7月1日上午9:30"
        })
      ])
    );
  });

  it("识别电子送达链接、账号密码和人工登录状态", () => {
    const parsed = parseSms(
      "【12368】你有法律文书待签收，案号（2026）浙0106民初888号，请登录https://songda.example.com/doc?id=abc，账号：lawyer001，密码：Abc12345，验证码：778899。"
    );

    expect(parsed.smsType).toBe("SERVICE_NOTICE");
    expect(parsed.urls).toEqual(["https://songda.example.com/doc?id=abc"]);
    expect(parsed.credentials.map((c) => c.label)).toEqual(["账号", "密码", "验证码"]);
    expect(parsed.credentials[1].valuePreview).not.toBe("Abc12345");
    expect(parsed.documentLinks[0]).toMatchObject({
      url: "https://songda.example.com/doc?id=abc",
      requiresLogin: true
    });
  });

  it("把举证、缴费等日期识别成待处理事项", () => {
    const parsed = parseSms(
      "【法院通知】请于2026年6月25日前提交证据材料，并于2026年6月20日前缴纳诉讼费500元。详情：https://court.example.com/pay。"
    );

    expect(parsed.smsType).toBe("FEE_NOTICE");
    expect(parsed.amounts).toContain("500元");
    expect(parsed.importantItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "EVIDENCE_DEADLINE", dateText: "2026年6月25日" }),
        expect.objectContaining({ kind: "FEE_DEADLINE", dateText: "2026年6月20日" })
      ])
    );
    expect(parsed.urls).toEqual(["https://court.example.com/pay"]);
  });
});
