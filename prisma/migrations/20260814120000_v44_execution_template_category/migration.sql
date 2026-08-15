-- v44: 执行文书模板类别（融合执行律师工作流 2026-08-14）
-- PG enum 加值，向后兼容，无数据迁移。
ALTER TYPE "TemplateCategory" ADD VALUE IF NOT EXISTS 'EXECUTION';
