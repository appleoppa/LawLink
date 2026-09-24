-- CreateEnum
CREATE TYPE "DocumentSourceOrigin" AS ENUM ('CLIENT_PROVIDED', 'COURT_SERVED', 'AI_EXTRACTED', 'SELF_COLLECTED', 'TEAM_PRODUCED');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "sourceOrigin" "DocumentSourceOrigin";

