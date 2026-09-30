import type { Metadata } from "next";
import { ApplicationForm } from "@/features/campus/controls";
import { BRAND } from "@/lib/brand";
import { db } from "@/server/db";
import { openCycles } from "@/server/services/admissions";

export const metadata: Metadata = { title: "Apply for admission" };
export const dynamic = "force-dynamic";

/** Public online application — no account needed. */
export default async function ApplyPage() {
  const [cycles, inst] = await Promise.all([openCycles(), db.institution.findFirst({ select: { name: true } })]);
  const open = cycles.filter((c) => c.seats.length > 0);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="text-xs font-semibold tracking-[0.15em] text-muted-foreground">{inst?.name ?? BRAND.name}</div>
      <h1 className="mt-2 text-2xl font-semibold">Apply for admission</h1>
      {open.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Online applications are not open at the moment. Please check back later.</p>
      ) : (
        <>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">After you submit, you will get a private link to follow your application and respond to an offer. Keep it safe; it is also e-mailed to you.</p>
          <ApplicationForm cycles={open.map((c) => ({ id: c.id, name: c.name, closesAt: c.closesAt.toISOString(), programs: c.seats.map((s) => ({ id: s.program.id, name: `${s.program.name} (${s.program.code})` })) }))} />
        </>
      )}
    </main>
  );
}
