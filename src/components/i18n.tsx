"use client";

import { createContext, useContext } from "react";

const Ctx = createContext<Record<string, string>>({});

/** Gives client components the current language's dictionary (empty for English). */
export function I18nProvider({ dict, children }: { dict: Record<string, string>; children: React.ReactNode }) {
  return <Ctx.Provider value={dict}>{children}</Ctx.Provider>;
}

export function useT() {
  const dict = useContext(Ctx);
  return (text: string) => dict[text] ?? text;
}
