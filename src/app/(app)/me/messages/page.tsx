import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { savePreferencesAction } from "@/features/campuslife/actions";
import { PushToggle } from "@/features/campuslife/controls";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { pushPublicKey } from "@/server/services/messaging";

export const metadata: Metadata = { title: "Notifications & messages" };

export default async function MessagesPage() {
  const ctx = await requirePageAuth();
  const [pref, key] = await Promise.all([db.contactPreference.findUnique({ where: { userId: ctx.user.id } }), pushPublicKey()]);
  const smsLive = env.SMS_DRIVER !== "outbox";
  const waLive = env.WHATSAPP_DRIVER !== "outbox";
  return (
    <div className="space-y-6">
      <PageHeader title="Notifications & messages" description="Get alerts on your phone. Install this site as an app (browser menu → Install / Add to Home screen) for the best experience." />
      <Section title="Push notifications" description="Free alerts to this phone or computer for everything that appears in your notification bell.">
        <PushToggle publicKey={key} />
      </Section>
      <Section
        title="SMS and WhatsApp"
        description="For important alerts only: fees, results, revaluation, library due dates, placement updates, counselling bookings, grievances, events and convocation. On WhatsApp you can also reply ATTENDANCE, FEES or RESULTS."
        actions={<FormDialog title="SMS and WhatsApp" action={savePreferencesAction} id="prefs" initial={{ phone: pref?.phone ?? "", sms: pref?.sms ?? false, whatsapp: pref?.whatsapp ?? false }} trigger={<Button size="sm" variant="outline">Change</Button>}
          fields={[{ name: "phone", label: "Mobile number with country code", type: "text", optional: true, placeholder: "+91 98765 43210" }, { name: "sms", label: "Send important alerts by SMS", type: "checkbox" }, { name: "whatsapp", label: "Send important alerts on WhatsApp", type: "checkbox" }]} />}
      >
        <KeyValue items={[["Mobile", pref?.phone ?? "Not given"], ["SMS", pref?.sms ? "On" : "Off"], ["WhatsApp", pref?.whatsapp ? "On" : "Off"]]} />
        {(!smsLive || !waLive) && <p className="mt-3 text-xs text-muted-foreground">{[!smsLive && "SMS", !waLive && "WhatsApp"].filter(Boolean).join(" and ")} delivery is not connected to a provider on this installation yet; your choice is saved and takes effect once it is.</p>}
      </Section>
    </div>
  );
}
