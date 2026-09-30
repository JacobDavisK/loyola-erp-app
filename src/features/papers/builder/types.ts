import type { PaperItemData } from "@/lib/domain/paper-types";

export interface BuilderSection {
  key: string; // stable client key
  id?: string; // server id (existing sections)
  label: string;
  title: string;
  instructions: string | null;
  attemptCount: number | null;
  marksPerQuestion: number | null;
  parentLabel: string | null;
  items: PaperItemData[];
}

export interface BuilderUnit {
  number: number;
  title: string;
  topics: { id: string; title: string }[];
}
