/**
 * Builds the immutable PaperSnapshot from database records. Pure (no DB access) so the seed,
 * services and tests share exactly one implementation.
 */
import type { BloomLevel, Difficulty, QuestionType } from "@/generated/prisma/enums";
import { EXAM_TYPE_LABEL } from "@/lib/domain/labels";
import type { PaperExamMeta, PaperSnapshot, QuestionOptionData } from "@/lib/domain/paper-types";
import type { ExamType } from "@/generated/prisma/enums";

/** Prisma include used to load a paper for snapshotting / rendering. */
export const PAPER_CONTENT_INCLUDE = {
  sections: {
    orderBy: { order: "asc" },
    include: {
      items: {
        orderBy: { order: "asc" },
        include: {
          questionVersion: true,
          question: {
            select: {
              code: true,
              unit: { select: { number: true, title: true } },
              topic: { select: { title: true } },
              outcome: { select: { code: true } },
            },
          },
        },
      },
    },
  },
  examination: {
    include: {
      course: { include: { program: true, semester: true, regulation: true } },
      session: true,
      schedule: true,
    },
  },
} as const;

export interface PaperContentRecord {
  id: string;
  code: string;
  title: string;
  setLabel: string;
  instructions: string | null;
  sections: {
    id: string;
    label: string;
    title: string;
    instructions: string | null;
    attemptCount: number | null;
    marksPerQuestion: number | null;
    parentId: string | null;
    items: {
      id: string;
      marks: number;
      questionId: string;
      questionVersionId: string;
      questionVersion: {
        version: number;
        body: string;
        options: unknown;
        type: QuestionType;
        difficulty: Difficulty;
        bloom: BloomLevel;
      };
      question: {
        code: string;
        unit: { number: number; title: string };
        topic: { title: string } | null;
        outcome: { code: string } | null;
      };
    }[];
  }[];
  examination: {
    maxMarks: number;
    durationMinutes: number;
    course: {
      code: string;
      title: string;
      program: { name: string };
      semester: { name: string };
      regulation: { code: string };
    };
    session: { name: string; code: string; examType: ExamType };
    schedule: { date: Date } | null;
  };
}

export function buildExamMeta(
  exam: PaperContentRecord["examination"],
  institution: { name: string; tagline?: string | null },
): PaperExamMeta {
  return {
    institutionName: institution.name,
    institutionTagline: institution.tagline ?? null,
    sessionName: exam.session.name,
    sessionCode: exam.session.code,
    examTypeLabel: EXAM_TYPE_LABEL[exam.session.examType],
    courseCode: exam.course.code,
    courseTitle: exam.course.title,
    programName: exam.course.program.name,
    semesterName: exam.course.semester.name,
    regulationCode: exam.course.regulation.code,
    durationMinutes: exam.durationMinutes,
    maxMarks: exam.maxMarks,
    examDate: exam.schedule?.date.toISOString() ?? null,
  };
}

export function buildSnapshot(
  paper: PaperContentRecord,
  institution: { name: string; tagline?: string | null },
): PaperSnapshot {
  return {
    schema: 1,
    paper: {
      id: paper.id,
      code: paper.code,
      title: paper.title,
      setLabel: paper.setLabel,
      instructions: paper.instructions,
    },
    exam: buildExamMeta(paper.examination, institution),
    sections: paper.sections.map((s) => ({
      id: s.id,
      label: s.label,
      title: s.title,
      instructions: s.instructions,
      attemptCount: s.attemptCount,
      marksPerQuestion: s.marksPerQuestion,
      parentId: s.parentId,
      items: s.items.map((i) => ({
        itemId: i.id,
        questionId: i.questionId,
        questionCode: i.question.code,
        versionId: i.questionVersionId,
        version: i.questionVersion.version,
        body: i.questionVersion.body,
        options: (i.questionVersion.options as QuestionOptionData | null) ?? null,
        marks: i.marks,
        type: i.questionVersion.type,
        difficulty: i.questionVersion.difficulty,
        bloom: i.questionVersion.bloom,
        unitNumber: i.question.unit.number,
        unitTitle: i.question.unit.title,
        outcomeCode: i.question.outcome?.code ?? null,
        topic: i.question.topic?.title ?? null,
      })),
    })),
  };
}
