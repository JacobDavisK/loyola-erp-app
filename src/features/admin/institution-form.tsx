"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ImageUp, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveInstitutionAction, uploadLogoAction } from "@/features/admin/actions";

export function InstitutionForm({ initial, logoUrl }: { initial: Record<"name" | "shortName" | "tagline" | "address" | "phone" | "email" | "website", string>; logoUrl: string | null }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const field = (k: keyof typeof v, label: string, props: React.ComponentProps<"input"> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`i-${k}`}>{label}</Label>
      <Input id={`i-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...props} />
    </div>
  );
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <form
        className="surface-card space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveInstitutionAction({ ...v, tagline: v.tagline || null, address: v.address || null, phone: v.phone || null });
            if (!r.ok) {
              toast.error(r.error, { description: r.fieldErrors ? Object.values(r.fieldErrors).flat().join(" · ") : undefined });
              return;
            }
            toast.success("Institution profile saved");
            router.refresh();
          });
        }}
      >
        <div className="grid gap-4 md:grid-cols-[1fr_160px]">
          {field("name", "Institution name", { required: true })}
          {field("shortName", "Short name", { required: true })}
        </div>
        {field("tagline", "Line under the name on papers (e.g. Office of the Controller of Examinations)")}
        <div className="space-y-1.5">
          <Label htmlFor="i-address">Address</Label>
          <Textarea id="i-address" rows={2} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {field("phone", "Phone")}
          {field("email", "E-mail", { type: "email" })}
          {field("website", "Website", { type: "url", placeholder: "https://" })}
        </div>
        <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save</Button></div>
      </form>
      <section className="surface-card p-5">
        <h2 className="text-sm font-semibold">University logo</h2>
        <p className="mt-1 text-xs text-muted-foreground">Printed at the top of every question paper. PNG, JPEG or WebP, up to 1 MB. Stored encrypted.</p>
        <div className="my-4 grid h-32 place-items-center rounded-lg border border-dashed bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoUrl ? <img src={logoUrl} alt="Current logo" className="max-h-24 max-w-[80%]" /> : <span className="text-xs text-neutral-400">No logo uploaded</span>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const fd = new FormData();
            fd.set("file", f);
            start(async () => {
              const r = await uploadLogoAction(fd);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success("Logo updated");
              router.refresh();
            });
          }}
        />
        <Button variant="outline" className="w-full" disabled={pending} onClick={() => fileRef.current?.click()}><ImageUp /> Upload logo</Button>
      </section>
    </div>
  );
}
