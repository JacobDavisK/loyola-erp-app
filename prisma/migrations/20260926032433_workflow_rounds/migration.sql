-- DropIndex
DROP INDEX "WorkflowTask_instanceId_stepIndex_idx";

-- AlterTable
ALTER TABLE "WorkflowInstance" ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "WorkflowTask" ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "WorkflowTask_instanceId_round_stepIndex_idx" ON "WorkflowTask"("instanceId", "round", "stepIndex");

