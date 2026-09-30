"use client";

import { usePathname } from "next/navigation";
import { LinkTabs } from "@/components/app/list";

export function AdminNav({ tabs }: { tabs: { key: string; label: string; href: string }[] }) {
  const path = usePathname();
  const active = tabs.find((t) => path === t.href || path.startsWith(t.href + "/"))?.key ?? tabs[0]?.key ?? "";
  return <LinkTabs className="mb-6" active={active} tabs={tabs} />;
}
