import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { saveLtiToolAction } from "@/features/teaching/actions";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { platformDetails } from "@/server/services/lti";

export const metadata: Metadata = { title: "External tools (LTI)" };

const FIELDS: FormField[] = [
  { name: "name", label: "Tool name", type: "text", wide: true },
  { name: "oidcLoginUrl", label: "Login initiation URL (from the tool)", type: "text", wide: true },
  { name: "launchUrl", label: "Launch / redirect URL", type: "text", wide: true },
  { name: "jwksUrl", label: "Tool's public key set (JWKS) URL", type: "text", wide: true },
  { name: "redirectUris", label: "Other redirect URLs (space-separated)", type: "text", optional: true, wide: true },
  { name: "sharePersonalData", label: "Send users' names and e-mail addresses to the tool", type: "checkbox" },
  { name: "enabled", label: "Enabled", type: "checkbox" },
];

export default async function LtiAdminPage() {
  await requirePageAuth("lti.manage");
  const p = platformDetails();
  const tools = await db.ltiTool.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { links: true } } } });
  return (
    <div className="space-y-6">
      <PageHeader
        title="External learning tools (LTI 1.3)"
        description="Register tools such as plagiarism checkers, simulations or publisher content. Teachers then add them to their course modules; students are signed in automatically and tools can send scores to the gradebook."
        actions={<FormDialog title="Tool" columns={2} fields={FIELDS} action={saveLtiToolAction} initial={{ sharePersonalData: false, enabled: true }} trigger={<Button size="sm"><Plus /> Register tool</Button>} />}
      />
      <Section title="Give these to the tool provider">
        <KeyValue items={[["Issuer (platform ID)", <code key="i">{p.issuer}</code>], ["Authorization endpoint", <code key="a">{p.authorizeUrl}</code>], ["Access token URL", <code key="t">{p.tokenUrl}</code>], ["Public keys (JWKS)", <code key="j">{p.jwksUrl}</code>]]} />
      </Section>
      <Section title="Registered tools" bodyClassName="p-0">
        <DataTable head={[{ label: "Tool" }, { label: "Client ID" }, { label: "Deployment ID" }, { label: "Placements" }, { label: "Status" }, { label: "" }]} empty="No tools registered.">
          {tools.map((t) => (
            <tr key={t.id}>
              <Td><div className="font-medium">{t.name}</div><div className="text-xs text-muted-foreground">{t.launchUrl}</div></Td>
              <Td className="font-mono text-xs">{t.clientId}</Td>
              <Td className="font-mono text-xs">{t.deploymentId}</Td>
              <Td>{t._count.links}</Td>
              <Td className="text-xs">{t.enabled ? "Enabled" : "Disabled"}{t.sharePersonalData ? " · receives names" : ""}</Td>
              <Td className="text-right"><FormDialog title="Tool" columns={2} id={t.id} fields={FIELDS} action={saveLtiToolAction} initial={{ name: t.name, oidcLoginUrl: t.oidcLoginUrl, launchUrl: t.launchUrl, jwksUrl: t.jwksUrl, redirectUris: t.redirectUris.join(" "), sharePersonalData: t.sharePersonalData, enabled: t.enabled }} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
