-- v0.42: 期限分类新增"保全期限"
ALTER TYPE "DeadlineCategory" ADD VALUE IF NOT EXISTS 'PRESERVATION';
