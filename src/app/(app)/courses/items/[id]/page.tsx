import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { requirePageAuth } from "@/server/auth/current";
import { openItem } from "@/server/services/lms";
import { signedAssetUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Course material" };

/** One learning item, for instructors and registered students (views are recorded for students). */
export default async function LearningItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const r = await openItem(ctx, id).catch(() => null);
  if (!r) notFound();
  const { item, role } = r;
  const back = role === "student" ? `/portal/courses/${item.module.offeringId}` : `/teaching/courses/${item.module.offeringId}`;
  const inline = item.file && (item.file.mimeType === "application/pdf" || item.file.mimeType.startsWith("image/"));
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader eyebrow={item.module.title} title={item.title} breadcrumbs={[{ label: "Course", href: back }, { label: item.title }]} />
      {item.kind === "LTI" && item.ltiLinkId && (
        <Section title="External tool" description="Opens the tool in this window; you are signed in to it automatically.">
          <a className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90" href={`/lti/launch/${item.ltiLinkId}`}>Open {item.title}</a>
        </Section>
      )}
      {item.kind === "PAGE" && <Section title="Content"><div className="prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">{item.body}</div></Section>}
      {(item.kind === "LINK" || item.kind === "VIDEO") && item.url && (
        <Section title={item.kind === "VIDEO" ? "Video" : "Link"}>
          {item.body && <p className="mb-3 whitespace-pre-wrap text-sm">{item.body}</p>}
          <Button asChild><a href={item.url} target="_blank" rel="noopener noreferrer nofollow"><ExternalLink /> Open {new URL(item.url).hostname}</a></Button>
          <p className="mt-2 text-xs text-muted-foreground">Opens an external site in a new tab.</p>
        </Section>
      )}
      {item.kind === "FILE" && item.file && (
        <Section title={item.file.originalName} description={`${Math.ceil(item.file.size / 1024)} KB`}>
          {item.body && <p className="mb-3 whitespace-pre-wrap text-sm">{item.body}</p>}
          <div className="flex flex-wrap gap-2">
            {inline && <Button asChild variant="outline"><a href={signedAssetUrl(item.file.id, 900, "inline")} target="_blank" rel="noopener">View</a></Button>}
            <Button asChild><a href={signedAssetUrl(item.file.id, 900, "attachment")}><Download /> Download</a></Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Links are private to signed-in users and expire after 15 minutes.</p>
        </Section>
      )}
      <Link href={back} className="text-sm text-primary hover:underline">← Back to the course</Link>
    </div>
  );
}
