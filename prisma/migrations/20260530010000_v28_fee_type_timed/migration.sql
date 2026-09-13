-- v0.28: 律师费新增"计时收费"
ALTER TYPE "FeeType" ADD VALUE IF NOT EXISTS 'TIMED';
