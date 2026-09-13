"use client";

import type { ReactNode } from "react";
import { ClipboardCheck } from "lucide-react";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import styles from "./review-dialog.module.css";

/** 审阅窗口只组织资料与操作，权限和提交逻辑由调用方持有。 */
export function ReviewDialogContent({ title, description, eyebrow, status, summary, tabs, sidebar, sidebarTitle, sidebarDescription }: {
  title: string;
  description: ReactNode;
  eyebrow: string;
  status?: ReactNode;
  summary?: ReactNode;
  tabs: { id: string; label: string; icon?: ReactNode; count?: number; content: ReactNode }[];
  sidebar: ReactNode;
  sidebarTitle: string;
  sidebarDescription?: string;
}) {
  return <DialogContent className={`flex h-[90dvh] max-h-[960px] w-[calc(100%-48px)] max-w-[1180px] flex-col gap-0 overflow-hidden p-0 ${styles.dialog}`}>
    <DialogHeader className={styles.header}>
      <div className={styles.eyebrow}><ClipboardCheck size={15} />{eyebrow}{status}</div>
      <DialogTitle className={styles.title}>{title}</DialogTitle>
      <DialogDescription className={styles.subtitle}>{description}</DialogDescription>
    </DialogHeader>
    <div className={styles.workspace}>
      <Tabs defaultValue={tabs[0]?.id} className={styles.reader}>
        {summary}
        <TabsList aria-label="申请详情分区" className={styles.tabs}>{tabs.map(tab => <TabsTrigger key={tab.id} value={tab.id}>{tab.icon}{tab.label}{tab.count != null && <span className={styles.tabCount}>{tab.count}</span>}</TabsTrigger>)}</TabsList>
        {tabs.map(tab => <TabsContent key={tab.id} value={tab.id} forceMount className={`${styles.panel} data-[state=inactive]:hidden`}>{tab.content}</TabsContent>)}
      </Tabs>
      <aside className={styles.decision} aria-label={sidebarTitle}>
        <div className={styles.decisionHeading}><span className={styles.sectionIcon}><ClipboardCheck size={18} /></span><div><h3>{sidebarTitle}</h3>{sidebarDescription && <p>{sidebarDescription}</p>}</div></div>
        {sidebar}
      </aside>
    </div>
  </DialogContent>;
}

export function ReviewFields({ fields }: { fields: { label: string; value: string }[] }) {
  return <dl className={styles.reviewFields}>{fields.map((field, index) => <div key={`${field.label}-${index}`} className={field.value.length > 55 || /说明|原因|摘要|事由|备注|总结|裁判结果/.test(field.label) ? styles.wideField : undefined}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>;
}
