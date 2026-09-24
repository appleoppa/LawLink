-- v0.42: 程序备忘录表
CREATE TABLE "ProcedureMemo" (
  "id" TEXT NOT NULL,
  "procedureId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "done" BOOLEAN NOT NULL DEFAULT false,
  "doneAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProcedureMemo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProcedureMemo_procedureId_idx" ON "ProcedureMemo"("procedureId");
ALTER TABLE "ProcedureMemo" ADD CONSTRAINT "ProcedureMemo_procedureId_fkey"
  FOREIGN KEY ("procedureId") REFERENCES "MatterProcedure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
