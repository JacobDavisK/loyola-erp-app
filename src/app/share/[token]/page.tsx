import type { Metadata } from "next";
import { BadgeCheck, CircleX } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { openShare } from "@/server/services/vc";

export const metadata: Metadata = { title: "Shared credential" };
export const dynamic = "force-dynamic";

type Vc = { name?: string; issuer?: { name?: string }; issuanceDate?: string; credentialSubject?: { name?: string; achievement?: { name?: string; achievementType?: string; description?: string; creditsAvailable?: number; tag?: string[] }; achievements?: { name: string; achievementType: string; creditsAvailable?: number; result?: { value: string }[] }[]; programme?: string; cgpa?: number; result?: { value: string; resultDescription?: string }[] } };

/** What an employer sees at a link the student shared (no sign-in). */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await openShare(token);
  if (!r) return <main className="mx-auto max-w-2xl px-4 py-12"><h1 className="text-xl font-semibold">This link has expired or was switched off.</h1><p className="mt-2 text-sm text-muted-foreground">Ask the person who shared it for a new link.</p></main>;
  const vc = (r.check.vc ?? {}) as Vc;
  const s = vc.credentialSubject ?? {};
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="text-xs font-semibold tracking-[0.15em] text-muted-foreground">{vc.issuer?.name ?? BRAND.name}</div>
      <h1 className="mt-2 text-2xl font-semibold">{vc.name}</h1>
      <p className="mt-1 text-sm">Awarded to <b>{s.name}</b>{vc.issuanceDate ? ` on ${vc.issuanceDate.slice(0, 10)}` : ""}</p>
      <div role="status" className={r.check.valid ? "mt-6 rounded-lg border border-tone-success/40 bg-tone-success/5 p-4 text-sm" : "mt-6 rounded-lg border border-tone-danger/40 bg-tone-danger/5 p-4 text-sm"}>
        <p className="flex items-center gap-2 font-semibold">{r.check.valid ? <><BadgeCheck className="size-5 text-tone-success" /> Verified: genuine, unaltered and not revoked</> : <><CircleX className="size-5 text-tone-danger" /> Not valid</>}</p>
        {r.check.problems.length > 0 && <ul className="mt-2 list-disc pl-5">{r.check.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      </div>
      {s.achievement && (
        <section className="mt-6 space-y-1 text-sm">
          <p><span className="text-muted-foreground">Type:</span> {s.achievement.achievementType}</p>
          {s.achievement.description && <p>{s.achievement.description}</p>}
          {s.achievement.creditsAvailable && <p><span className="text-muted-foreground">Credits:</span> {s.achievement.creditsAvailable}</p>}
          {s.achievement.tag && <p><span className="text-muted-foreground">Skills:</span> {s.achievement.tag.join(", ")}</p>}
          {s.result?.map((x) => <p key={x.value}><span className="text-muted-foreground">{x.resultDescription ?? "Result"}:</span> {x.value}</p>)}
        </section>
      )}
      {s.achievements && (
        <section className="mt-6">
          <p className="text-sm">{s.programme}{s.cgpa ? ` · CGPA ${s.cgpa}` : ""}</p>
          <table className="mt-3 w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1">Achievement</th><th>Type</th><th>Credits</th><th>Result</th></tr></thead>
            <tbody>{s.achievements.map((a, i) => <tr key={i} className="border-b last:border-0"><td className="py-1.5">{a.name}</td><td className="text-xs">{a.achievementType}</td><td>{a.creditsAvailable ?? ""}</td><td>{a.result?.[0]?.value ?? ""}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </main>
  );
}
