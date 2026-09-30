import type { BloomLevel, BlueprintDimension, Difficulty, QuestionType } from "@/generated/prisma/enums";

export interface QuestionOptionData {
  /** MCQ / assertion-reason choices */
  choices?: { label: string; text: string; correct?: boolean }[];
  /** match-the-following pairs */
  pairs?: { left: string; right: string }[];
}

export interface PaperItemData {
  itemId: string;
  questionId: string;
  questionCode: string;
  versionId: string;
  version: number;
  body: string;
  options: QuestionOptionData | null;
  marks: number;
  type: QuestionType;
  difficulty: Difficulty;
  bloom: BloomLevel;
  unitNumber: number;
  unitTitle?: string;
  outcomeCode: string | null;
  topic: string | null;
}

export interface PaperSectionData {
  id: string;
  label: string;
  title: string;
  instructions: string | null;
  attemptCount: number | null;
  marksPerQuestion: number | null;
  parentId?: string | null;
  items: PaperItemData[];
}

export interface PaperExamMeta {
  institutionName: string;
  institutionTagline?: string | null;
  sessionName: string;
  sessionCode: string;
  examTypeLabel: string;
  courseCode: string;
  courseTitle: string;
  programName: string;
  semesterName: string;
  regulationCode: string;
  durationMinutes: number;
  maxMarks: number;
  examDate?: string | null;
}

/** Immutable, self-contained representation of a paper (stored in QuestionPaperVersion.snapshot). */
export interface PaperSnapshot {
  schema: 1;
  paper: {
    id: string;
    code: string;
    title: string;
    setLabel: string;
    instructions: string | null;
  };
  exam: PaperExamMeta;
  sections: PaperSectionData[];
}

export interface BlueprintSectionSpec {
  label: string;
  title: string;
  questionCount: number;
  attemptCount: number;
  marksPerQuestion: number;
  questionTypes: QuestionType[];
  units: number[];
  instructions?: string | null;
}

export interface BlueprintRuleSpec {
  dimension: BlueprintDimension;
  key: string;
  targetPercent: number;
  tolerance: number;
}

export interface BlueprintSpec {
  totalMarks: number;
  durationMinutes: number;
  sections: BlueprintSectionSpec[];
  rules: BlueprintRuleSpec[];
}
