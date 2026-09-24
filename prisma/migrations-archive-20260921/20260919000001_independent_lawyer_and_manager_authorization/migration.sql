-- 2026-09-19 岗位与管理权解耦：
-- 1) 新增「独立律师」枚举值（合伙人/独立律师/授薪律师/律师助理）
-- 2) User.managerAuthorized：按人授予业务管理权（等同合伙人业务权限），与岗位分类无关
-- 仅新增，不改旧值、不改写存量数据

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'INDEPENDENT_LAWYER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "managerAuthorized" BOOLEAN NOT NULL DEFAULT false;
