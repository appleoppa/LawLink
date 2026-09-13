/**
 * v0.9.3 快递追踪：双 provider 调用（快递鸟主 + 快递100 备）
 *
 * server-only（用了 node:crypto + getExpressSettings 读 SystemSetting）。
 * client 端需要的常量/纯函数请 import "./companies"。
 */
import { createHash } from "node:crypto";
import { getExpressSettings } from "./settings";
import { COMPANY_CODES, detectCompany } from "./companies";

// 给 server-only 调用者继续 import 自此处
export { COMPANY_CODES, SUPPORTED_COMPANIES, detectCompany } from "./companies";

export interface TrackTrace {
  time: string;
  desc: string;
}

export interface TrackResult {
  provider: "快递鸟" | "快递100";
  companyName: string;
  trackingNo: string;
  state: string; // 中文状态
  traces: TrackTrace[];
}

const KDNIAO_STATE: Record<string, string> = {
  "0": "暂无信息",
  "1": "已揽件",
  "2": "在途中",
  "201": "到达派件城市",
  "3": "已签收",
  "301": "疑难件",
  "4": "退签"
};

const KD100_STATE: Record<string, string> = {
  "0": "在途",
  "1": "揽收",
  "2": "疑难",
  "3": "已签收",
  "4": "退签",
  "5": "派件中",
  "6": "退回",
  "7": "转投"
};

async function callKdniao(opts: {
  ebusinessId: string;
  appKey: string;
  trackingNo: string;
  shipperCode: string;
}): Promise<TrackResult> {
  const requestData = JSON.stringify({
    OrderCode: "",
    ShipperCode: opts.shipperCode,
    LogisticCode: opts.trackingNo
  });
  const md5 = createHash("md5")
    .update(requestData + opts.appKey)
    .digest("hex");
  const dataSign = Buffer.from(md5, "utf-8").toString("base64");
  const params = new URLSearchParams({
    RequestData: requestData,
    EBusinessID: opts.ebusinessId,
    RequestType: "1002",
    DataSign: dataSign,
    DataType: "2"
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch("http://api.kdniao.com/Ebusiness/EbusinessOrderHandle.aspx", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: ctrl.signal
    });
    const json = (await res.json()) as {
      Success?: boolean | string;
      State?: string | number;
      Reason?: string;
      Traces?: { AcceptTime?: string; AcceptStation?: string }[];
    };
    const success = json.Success === true || json.Success === "true";
    if (!success) {
      throw new Error(json.Reason || "快递鸟查询失败");
    }
    const traces = (json.Traces ?? []).map((t) => ({
      time: t.AcceptTime ?? "",
      desc: t.AcceptStation ?? ""
    }));
    // 取该 shipperCode 对应的中文名
    const cnName = Object.entries(COMPANY_CODES).find(
      ([, v]) => v[1] === opts.shipperCode
    )?.[0] ?? opts.shipperCode;
    return {
      provider: "快递鸟",
      companyName: cnName,
      trackingNo: opts.trackingNo,
      state: KDNIAO_STATE[String(json.State ?? "0")] ?? "未知",
      traces
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callKuaidi100(opts: {
  customer: string;
  key: string;
  trackingNo: string;
  comCode: string;
}): Promise<TrackResult> {
  const param = JSON.stringify({
    com: opts.comCode,
    num: opts.trackingNo,
    phone: "",
    from: "",
    to: "",
    resultv2: "4"
  });
  const sign = createHash("md5")
    .update(param + opts.key + opts.customer)
    .digest("hex")
    .toUpperCase();
  const body = new URLSearchParams({
    customer: opts.customer,
    sign,
    param
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch("https://poll.kuaidi100.com/poll/query.do", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: ctrl.signal
    });
    const json = (await res.json()) as {
      status?: string;
      message?: string;
      state?: string;
      data?: { time?: string; context?: string }[];
    };
    if (json.status !== "200" && json.message !== "ok") {
      throw new Error(json.message || "快递100 查询失败");
    }
    const cnName = Object.entries(COMPANY_CODES).find(
      ([, v]) => v[0] === opts.comCode
    )?.[0] ?? opts.comCode;
    return {
      provider: "快递100",
      companyName: cnName,
      trackingNo: opts.trackingNo,
      state: KD100_STATE[String(json.state ?? "0")] ?? "未知",
      traces: (json.data ?? []).map((t) => ({
        time: t.time ?? "",
        desc: t.context ?? ""
      }))
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function trackExpress(input: {
  trackingNo: string;
  companyCode?: string; // 中文公司名（可空，自动识别）
}): Promise<TrackResult> {
  const s = await getExpressSettings();
  if (!s.kdniao.configured && !s.kuaidi100.configured) {
    throw new Error("请先到 管理后台 → 快递接入 配置 快递鸟 或 快递100");
  }

  const cnName =
    input.companyCode && COMPANY_CODES[input.companyCode]
      ? input.companyCode
      : detectCompany(input.trackingNo);
  if (!cnName) {
    throw new Error("无法自动识别快递公司，请手动选择");
  }
  const [kd100Code, kdniaoCode] = COMPANY_CODES[cnName];

  // 优先快递鸟
  if (s.kdniao.configured) {
    try {
      return await callKdniao({
        ebusinessId: s.kdniao.ebusinessId,
        appKey: s.kdniao.appKey,
        trackingNo: input.trackingNo,
        shipperCode: kdniaoCode
      });
    } catch (e) {
      if (!s.kuaidi100.configured) {
        throw e;
      }
      // 降级
    }
  }
  // 降级快递100
  return callKuaidi100({
    customer: s.kuaidi100.customer,
    key: s.kuaidi100.key,
    trackingNo: input.trackingNo,
    comCode: kd100Code
  });
}
