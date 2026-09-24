-- 2026-09-20 C 批 P2-6：INTAKE 草稿作废终态。
-- 枚举追加值无破坏、无回填（VOID 只由新动作写入）。
ALTER TYPE "IntakeStatus" ADD VALUE 'VOID';
