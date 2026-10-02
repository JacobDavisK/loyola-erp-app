import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, FileStack, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { academicVcAction, learnerRecordAction, revokeShareAction } from "@/features/wallet/actions";
import { ShareControl } from "@/features/wallet/controls";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { ensureBadgeVcs, institutionDid } from "@/server/services/vc";

export const metadata: Metadata = { title: "Credential wallet" };

const KIND = { ACADEMIC: "Certificate", BADGE: "Badge", LEARNER_RECORD: "Learner record" } as const;

export default async function WalletPage() {
  const ctx = await requirePageAuth("self.portal");
  const studentId = ctx.subject.studentId;
  if (!studentId) redirect("/portal");
  await ensureBadgeVcs(studentId);
  const now = new Date();
  const [vcs, creds, badges] = await Promise.all([
    db.verifiableCredential.findMany({ where: { studentId }, orderBy: { issuedAt: "desc" }, include: { shares: { where: { revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } } } }),
    db.issuedCredential.findMany({ where: { studentId, status: "ISSUED" }, orderBy: { issuedAt: "desc" } }),
    db.badgeAward.findMany({ where: { studentId, revokedAt: null }, include: { badge: true }, orderBy: { awardedAt: "desc" } }),
  ]);
  const name = (jwt: string) => { try { return String(JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).vc.name); } catch { return "Credential"; } };
  const withVc = new Set(vcs.filter((v) => !v.revokedAt && v.issuedCredentialId).map((v) => v.issuedCredentialId));
  const pending = creds.filter((c) => !withVc.has(c.id));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Credential wallet"
        breadcrumbs={[{ label: "My studies" }, { label: "Wallet" }]}
        description={<>Your certificates, badges and micro-credentials as internationally verifiable digital credentials (W3C Verifiable Credentials / Open Badges 3.0), signed by the institution ({institutionDid()}). Download them into a digital wallet or share a link; anyone can verify them at <Link className="text-primary hover:underline" href="/verify/vc">/verify/vc</Link>.</>}
        actions={<ActionButton label="Issue my learner record" icon={<FileStack />} run={learnerRecordAction} confirmText="Create a learner record of all your results, certificates and badges?" />}
      />
      {pending.length > 0 && (
        <Section title="Certificates not yet in your wallet" bodyClassName="p-0">
          <DataTable head={[{ label: "Certificate" }, { label: "Issued" }, { label: "" }]}>
            {pending.map((c) => (
              <tr key={c.id}>
                <Td><span className="font-medium">{c.title}</span> <span className="font-mono text-xs text-muted-foreground">{c.serialNo}</span></Td>
                <Td className="text-xs">{fmtDate(c.issuedAt)}</Td>
                <Td className="text-right"><ActionButton size="xs" label="Add to wallet" icon={<Wallet />} run={academicVcAction.bind(null, c.id)} /></Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      <Section title="My verifiable credentials" bodyClassName="p-0">
        <DataTable head={[{ label: "Credential" }, { label: "Issued" }, { label: "Download" }, { label: "Share" }]} empty="Nothing yet. Badges you earn appear here automatically; add certificates from the list above.">
          {vcs.map((v) => (
            <tr key={v.id} className="align-top">
              <Td><div className="font-medium">{name(v.jwt)}</div><div className="text-xs text-muted-foreground">{KIND[v.kind]}{v.revokedAt ? ` · revoked ${fmtDate(v.revokedAt)}` : ""}</div></Td>
              <Td className="text-xs">{fmtDate(v.issuedAt)}</Td>
              <Td className="whitespace-nowrap">
                <Button asChild size="xs" variant="ghost"><a href={`/api/credentials/vc/${v.id}`}><Download /> Wallet file</a></Button>
                <Button asChild size="xs" variant="ghost"><a href={`/api/credentials/vc/${v.id}?format=json`}>JSON</a></Button>
              </Td>
              <Td>
                {!v.revokedAt && <ShareControl vcId={v.id} />}
                {v.shares.map((s) => (
                  <div key={s.id} className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    {s.label ?? "Link"} · until {fmtDate(s.expiresAt)} · {s.views} view(s)
                    <ActionButton size="xs" variant="ghost" label="Stop" run={revokeShareAction.bind(null, s.id)} />
                  </div>
                ))}
              </Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      {badges.length > 0 && (
        <Section title="Badges and micro-credentials">
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {badges.map((b) => (
              <li key={b.id} className="rounded-xl border p-4">
                <div className="text-xs text-muted-foreground">{b.badge.kind === "MICRO_CREDENTIAL" ? "Micro-credential" : b.badge.kind === "CERTIFICATE_OF_PARTICIPATION" ? "Participation" : "Badge"}{b.badge.credits ? ` · ${b.badge.credits} credits` : ""}{b.badge.hours ? ` · ${b.badge.hours} h` : ""}</div>
                <div className="mt-0.5 font-medium">{b.badge.name}</div>
                <p className="mt-1 text-xs text-muted-foreground">{b.badge.description}</p>
                {b.badge.skills.length > 0 && <p className="mt-2 text-[11px]">{b.badge.skills.join(" · ")}</p>}
                <p className="mt-2 text-[11px] text-muted-foreground">Earned {fmtDate(b.awardedAt)}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
