import { describe, it, expect, vi } from "vitest";
import PizZip from "pizzip";
import { extractDocxVariables } from "@/lib/template-engine";
import { recordTimelineEvent } from "@/server/timeline/record";

function docxWith(xml: string): Buffer {
  const zip = new PizZip();
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document>${xml}</w:document>`);
  zip.file("word/header1.xml", `<?xml version="1.0"?><w:hdr>{{firm.name}}</w:hdr>`);
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}

describe("extractDocxVariables（模板上传变量提取）", () => {
  it("提取正文与页眉变量、循环段标签，去重排序", () => {
    const buf = docxWith(
      "<w:t>{{client.name}}</w:t><w:t>{{ client.idNumber }}</w:t><w:t>{{#plaintiffs}}</w:t><w:t>{{client.name}}</w:t>"
    );
    expect(extractDocxVariables(buf)).toEqual(["client.idNumber", "client.name", "firm.name", "plaintiffs"]);
  });

  it("跨 run 拆分的占位符（XML 标签穿插）仍可提取", () => {
    const buf = docxWith("<w:t>{{mat</w:t><w:t>ter.title}}</w:t>");
    expect(extractDocxVariables(buf)).toContain("matter.title");
  });

  it("无变量时返回空数组", () => {
    const buf = docxWith("<w:t>固定文本，无占位符</w:t>");
    expect(extractDocxVariables(buf)).toEqual(["firm.name"]); // 仅页眉示例变量
  });
});

describe("recordTimelineEvent（时间线唯一写入口）", () => {
  it("默认补 occurredAt，透传其余字段", async () => {
    const create = vi.fn(async () => ({}));
    await recordTimelineEvent({ timelineEvent: { create } } as never, {
      matterId: "cmatter000000000000000000001",
      eventType: "TEST",
      title: "测试事件",
      content: "说明"
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matterId: "cmatter000000000000000000001",
        eventType: "TEST",
        title: "测试事件",
        content: "说明",
        occurredAt: expect.any(Date)
      })
    });
  });
});
