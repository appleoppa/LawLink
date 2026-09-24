/**
 * 一次性清理：删除 v0.11 之前手填的 60+ 条旧 sample 民事案由
 *
 * 策略：只删除 db 里 (code, name) 都仍是旧值的记录（说明没被 xlsx 全量覆盖）。
 * 若 code 已被 xlsx 新数据覆盖（name 不同），保持现状不动。
 *
 * 数据来源：commit a195f63 prisma/seeds/causes-civil.ts
 *
 * 运行：npx tsx scripts/cleanup-legacy-causes.ts
 */
import { prisma } from "../src/lib/prisma";

const LEGACY: { code: string; name: string }[] = [
  { code: "CC-1-01", name: "名誉权纠纷" },
  { code: "CC-1-02", name: "隐私权纠纷" },
  { code: "CC-1-03", name: "肖像权纠纷" },
  { code: "CC-2-01", name: "离婚纠纷" },
  { code: "CC-2-02", name: "离婚后财产纠纷" },
  { code: "CC-2-03", name: "抚养纠纷" },
  { code: "CC-2-04", name: "赡养纠纷" },
  { code: "CC-2-05", name: "法定继承纠纷" },
  { code: "CC-2-06", name: "遗嘱继承纠纷" },
  { code: "CC-2-07", name: "婚约财产纠纷" },
  { code: "CC-2-08", name: "同居关系析产纠纷" },
  { code: "CC-2-09", name: "收养关系纠纷" },
  { code: "CC-2-10", name: "监护权纠纷" },
  { code: "CC-2-11", name: "夫妻财产约定纠纷" },
  { code: "CC-3-01", name: "物权保护纠纷" },
  { code: "CC-3-02", name: "相邻关系纠纷" },
  { code: "CC-3-03", name: "共有纠纷" },
  { code: "CC-3-04", name: "业主撤销权纠纷" },
  { code: "CC-3-05", name: "所有权确认纠纷" },
  { code: "CC-3-06", name: "排除妨害纠纷" },
  { code: "CC-3-07", name: "返还原物纠纷" },
  { code: "CC-3-08", name: "抵押权纠纷" },
  { code: "CC-3-09", name: "质权纠纷" },
  { code: "CC-4-01", name: "买卖合同纠纷" },
  { code: "CC-4-02", name: "借款合同纠纷" },
  { code: "CC-4-03", name: "民间借贷纠纷" },
  { code: "CC-4-04", name: "建设工程施工合同纠纷" },
  { code: "CC-4-05", name: "房屋租赁合同纠纷" },
  { code: "CC-4-06", name: "劳务合同纠纷" },
  { code: "CC-4-07", name: "服务合同纠纷" },
  { code: "CC-4-08", name: "委托合同纠纷" },
  { code: "CC-4-09", name: "承揽合同纠纷" },
  { code: "CC-4-10", name: "居间合同纠纷" },
  { code: "CC-4-11", name: "保证合同纠纷" },
  { code: "CC-4-12", name: "股权转让纠纷" },
  { code: "CC-4-13", name: "技术开发合同纠纷" },
  { code: "CC-4-14", name: "技术服务合同纠纷" },
  { code: "CC-4-15", name: "技术咨询合同纠纷" },
  { code: "CC-4-16", name: "运输合同纠纷" },
  { code: "CC-4-17", name: "保管合同纠纷" },
  { code: "CC-4-18", name: "仓储合同纠纷" },
  { code: "CC-4-19", name: "赠与合同纠纷" },
  { code: "CC-4-20", name: "物业服务合同纠纷" },
  { code: "CC-4-21", name: "旅游合同纠纷" },
  { code: "CC-4-22", name: "行纪合同纠纷" },
  { code: "CC-4-23", name: "特许经营合同纠纷" },
  { code: "CC-4-24", name: "合伙协议纠纷" },
  { code: "CC-4-25", name: "供用电合同纠纷" },
  { code: "CC-4-26", name: "中外合资经营企业合同纠纷" },
  { code: "CC-4-27", name: "保险合同纠纷" },
  { code: "CC-4-28", name: "金融借款合同纠纷" },
  { code: "CC-4-29", name: "融资租赁合同纠纷" },
  { code: "CC-5-01", name: "劳动合同纠纷" },
  { code: "CC-5-02", name: "追索劳动报酬纠纷" },
  { code: "CC-5-03", name: "确认劳动关系纠纷" },
  { code: "CC-5-04", name: "经济补偿金纠纷" },
  { code: "CC-5-05", name: "工伤待遇纠纷" },
  { code: "CC-5-06", name: "竞业限制纠纷" },
  { code: "CC-6-01", name: "著作权权属、侵权纠纷" },
  { code: "CC-6-02", name: "商标权权属、侵权纠纷" },
  { code: "CC-6-03", name: "专利权权属、侵权纠纷" },
  { code: "CC-6-04", name: "不正当竞争纠纷" },
  { code: "CC-6-05", name: "商业秘密纠纷" },
  { code: "CC-7-01", name: "股东资格确认纠纷" },
  { code: "CC-7-02", name: "股东出资纠纷" },
  { code: "CC-7-03", name: "公司决议纠纷" },
  { code: "CC-7-04", name: "股东损害公司债权人利益责任纠纷" },
  { code: "CC-7-05", name: "股东知情权纠纷" },
  { code: "CC-7-06", name: "公司解散纠纷" },
  { code: "CC-7-07", name: "请求公司收购股份纠纷" },
  { code: "CC-7-08", name: "票据纠纷" },
  { code: "CC-8-01", name: "机动车交通事故责任纠纷" },
  { code: "CC-8-02", name: "提供劳务者受害责任纠纷" },
  { code: "CC-8-03", name: "产品责任纠纷" },
  { code: "CC-8-04", name: "医疗损害责任纠纷" },
  { code: "CC-8-05", name: "网络侵权责任纠纷" },
  { code: "CC-8-06", name: "饲养动物损害责任纠纷" },
  { code: "CC-8-07", name: "物件损害责任纠纷" },
  { code: "CC-8-08", name: "教育机构责任纠纷" },
  { code: "CC-8-09", name: "高度危险责任纠纷" },
  { code: "CC-8-10", name: "环境污染责任纠纷" },
  { code: "CC-8-11", name: "名誉权纠纷" },
  { code: "CC-8-12", name: "隐私权纠纷" },
  { code: "CC-8-13", name: "肖像权纠纷" }
];

async function main() {
  let deleted = 0;
  let kept = 0;
  let missing = 0;
  let referenced = 0;
  const referencedSamples: string[] = [];

  for (const old of LEGACY) {
    const cur = await prisma.causeOfAction.findUnique({
      where: { category_code: { category: "CIVIL_COMMERCIAL", code: old.code } }
    });
    if (!cur) {
      missing++;
      continue;
    }
    // 名字不再匹配 → 已被 xlsx 新数据覆盖，保留
    if (cur.name !== old.name) {
      kept++;
      continue;
    }
    // 检查是否被 Intake / Matter 引用，被引用就跳过
    const [intakeCount, matterCount] = await Promise.all([
      prisma.intake.count({ where: { causeId: cur.id } }),
      prisma.matter.count({ where: { causeId: cur.id } })
    ]);
    if (intakeCount + matterCount > 0) {
      referenced++;
      if (referencedSamples.length < 5) {
        referencedSamples.push(`${old.code} ${old.name} (Intake=${intakeCount} Matter=${matterCount})`);
      }
      continue;
    }
    await prisma.causeOfAction.delete({ where: { id: cur.id } });
    deleted++;
  }

  console.log(`\n清理结果（共 ${LEGACY.length} 条候选）：`);
  console.log(`  - 已删除 (旧 code+name 未被覆盖且未被引用): ${deleted}`);
  console.log(`  - 保留 (code 已被 xlsx 新数据覆盖):           ${kept}`);
  console.log(`  - 保留 (被 Intake/Matter 引用):               ${referenced}`);
  console.log(`  - 不存在:                                      ${missing}`);
  if (referencedSamples.length > 0) {
    console.log(`\n被引用样本：`);
    for (const s of referencedSamples) console.log(`  ${s}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
