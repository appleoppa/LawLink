/** 审计列表使用中文；原始代码保留在技术详情中供排障。 */
const targetLabels: Record<string, string> = {
  Announcement: "公告", Approval: "审批", ArchiveRecord: "归档记录", AuditLog: "审计日志",
  Backup: "备份", Billing: "结算单", Client: "客户", ConflictCheck: "冲突检索", Contact: "联系人",
  Cron: "定时任务", CustomFieldDef: "自定义字段", Deadline: "期限", Document: "材料",
  DocumentFolder: "材料目录", DocumentTemplate: "文书模板", ExpressTracking: "快递跟踪",
  ExternalContact: "外部联系人", FeeEntry: "收付记录", FirmFile: "律所文书", Hearing: "开庭",
  Intake: "收案", InvoiceRequest: "开票申请", Matter: "案件", MatterList: "案件列表",
  MatterProcedure: "案件程序", MatterStage: "案件阶段", Note: "跟进记录", Party: "当事人",
  PreservationCase: "保全案件", PreservationProperty: "保全财产", Report: "报告", SealRequest: "用章申请",
  SmsMessage: "法院短信", StageTemplate: "阶段模板", SystemSetting: "系统设置", Task: "事项",
  Team: "律师团队", User: "用户", BuiltinRole: "内置角色", RoleDefinition: "自定义角色"
};
const words: Record<string, string> = {
  BUILTIN: "内置", ROLE: "角色", PRESENTATION: "显示资料", DEFINITION: "定义",
  IDENTITY: "身份信息", CORRECT: "更正", SELF: "本人",
  AI: "智能辅助", ALL: "全部", ANNOUNCEMENT: "公告", APPROVAL: "审批", APPROVE: "批准", APPROVED: "已批准",
  ARCHIVE: "归档", ATTACHMENT: "附件", ATTACHMENTS: "附件", AUDIT: "审计", AUTHORIZATION: "授权",
  AUTO: "自动", AVATAR: "头像", BACKFILL: "回填", BACKUP: "备份", BASIC: "基本信息", BATCH: "批量",
  BILLING: "结算单", BIND: "关联", CALENDAR: "日历订阅", CANCELLED: "已取消", CASE: "案件",
  CHECK: "检查", CLASSIFY: "分类", CLEAR: "清除", CLIENT: "客户", CLOSE: "结案", COMMISSION: "分成",
  COMPLETE: "完成", CONCLUSION: "结论", CONFLICT: "冲突", CONTACT: "联系人", CONVERT: "转正式案件",
  CREATE: "创建", CRON: "定时任务", CUSTOM: "自定义", DATABASE: "数据库", DEADLINE: "期限",
  DECLINE: "不接案", DECLINED: "不接案", DELETE: "删除", DETAIL: "详情", DOCUMENT: "材料",
  DOWNLOAD: "下载", DUE: "到期", ENTRY: "条目", ENTERPRISE: "企业", EXPIRED: "已过期", EXPORT: "导出",
  EXPRESS: "快递", EXTERNAL: "外部", EXTRACT: "提取", FAILED: "失败", FEE: "收付", FIELD: "字段",
  FILE: "文件", FILING: "立案", FIRM: "律所", FOLDER: "目录", GENERATE: "生成", GROUP: "权限组",
  HARD: "永久", HEARING: "开庭", HIDE: "隐藏", HOLD: "暂停", IMPORT: "导入", INFO: "信息",
  INTAKE: "收案", INVOICE: "开票", ISSUED: "已开具", KEY: "密钥", LEGACY: "历史申请", LINK: "关联",
  LOGIN: "登录", LOGOUT: "退出登录", MARK: "标记", MATCH: "匹配", MATTER: "案件", MATTERS: "案件",
  MOVE: "移动", NEEDS: "需要", NOTE: "跟进记录", NUMBER: "编号", OCR: "文字识别", OVERDUE: "逾期",
  PARSE: "解析", PARTY: "当事人", PERMISSION: "权限", PLAN: "方案", PRESERVATION: "保全",
  PREVIEW: "预览", PROCEDURE: "程序", PROCESSED: "已处理", PROFILE: "资料", PROPERTY: "财产",
  PURPOSE: "事项", PUSH: "推送", REFRESH: "刷新", REGENERATE: "重新生成", REJECT: "驳回", REJECTED: "已驳回",
  REMINDER: "提醒", REMOVE: "移除", RENAME: "重命名", REOPEN: "重新开启", REPLACE: "替换",
  REPORT: "报告", REQUEST: "申请", RESUBMIT: "重新提交", RETENTION: "保留", REVIEW: "审查",
  REVISION: "补正", RUN: "执行", SAVE: "保存", SCAN: "扫描", SEAL: "用章", SEARCH: "检索",
  SET: "设置", SETTINGS: "设置", SMS: "短信", STAGE: "阶段", STAMP: "盖章回填", STAMPED: "已盖章",
  STATUS: "状态", SUBMIT: "提交", SUMMARY: "摘要", TASK: "事项", TEAM: "团队", TEMPLATE: "模板",
  TOGGLE: "启停", TOGGLES: "开关", TOKEN: "订阅凭证", UNBIND: "解除关联", UPDATE: "更新",
  UPLOAD: "上传", USER: "用户", VALUES: "内容", VECTOR: "语义索引", VIEW: "查看", WEBHOOK: "群机器人",
  WEEKLY: "周报", WORKFLOW: "工作流", YUANDIAN: "元典", ADD: "添加", CLEANUP: "历史清理"
};
export function auditActionLabel(code: string): string {
  const parts = code.split("_");
  return parts.every(part => Object.hasOwn(words, part))
    ? parts.map(part => words[part]).join(" · ")
    : "其他操作（详见技术详情）";
}
export function auditTargetLabel(code: string | null | undefined): string {
  return code ? targetLabels[code] ?? "其他对象" : "—";
}
