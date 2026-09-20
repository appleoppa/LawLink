/** 全新业务演示数据。清理另走已审阅的本地切换 SQL；此脚本不删除任何数据。 */
import { PrismaClient } from '@prisma/client';
import { seedWorkflowDemo } from './seed-workflow-demo';
const db = new PrismaClient({log:[]});
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('只允许在本机数据库生成演示数据');
  const ownerId = process.argv.find(arg=>arg.startsWith('--owner='))?.slice(8);
  if (!ownerId) throw new Error('请使用 --owner=<现有承办账号 ID> 明确指定演示案件承办人');
  const result = await seedWorkflowDemo(db,ownerId);
  console.log(`本次生成场景 ${result.created.length} 个：${result.created.join('、') || '无'}；跳过已存在 ${result.skipped.length} 个。本批新增案件 ${result.matterIds.length} 个、收案 ${result.intakeIds.length} 个；收款待核对，账号与配置未改动。`);
}
main().catch(()=>{console.error('演示数据未生成：请核对本机新模型、承办账号权限和是否已存在演示样本；失败事务已回滚。');process.exitCode=1;}).finally(()=>db.$disconnect());
