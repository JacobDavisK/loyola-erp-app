-- AlterTable
ALTER TABLE "AnswerScript" ADD COLUMN     "absent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "malpractice" BOOLEAN NOT NULL DEFAULT false;

