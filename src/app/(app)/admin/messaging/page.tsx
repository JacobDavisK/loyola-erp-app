import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "SMS & WhatsApp" };

const mask = (phone: string) => phone.slice(0, -4).replace(/[0-9]/g, "•") + phone.slice(-4);

export default async function MessagingAdminPage() {
  await requirePageAuth("messaging.manage");
  const [rows, push, optIn] = await Promise.all([
    db.messageOutbox.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    db.pushSubscription.count(),
    db.contactPreference.groupBy({ by: ["sms", "whatsapp"], _count: { _all: true } }),
  ]);
  const sms = optIn.filter((o) => o.sms).reduce((a, o) => a + o._count._all, 0);
  const wa = optIn.filter((o) => o.whatsapp).reduce((a, o) => a + o._count._all, 0);
  return (
    <div className="space-y-6">
      <PageHeader title="SMS, WhatsApp & push" description="Delivery providers are set in the server environment (SMS_DRIVER=twilio, WHATSAPP_DRIVER=meta, with their keys). Without a provider, messages are recorded here but not sent." />
      <Section title="Status">
        <KeyValue items={[
          ["SMS", env.SMS_DRIVER === "twilio" ? "Twilio" : "Not connected (recorded only)"],
          ["WhatsApp", env.WHATSAPP_DRIVER === "meta" ? "Meta Cloud API" : "Not connected (recorded only)"],
          ["WhatsApp webhook", "/api/messaging/whatsapp"],
          ["Devices with push on", String(push)],
          ["Opted in to SMS / WhatsApp", `${sms} / ${wa}`],
        ]} />
      </Section>
      <Section title="Recent messages" bodyClassName="p-0">
        <DataTable head={[{ label: "When" }, { label: "Channel" }, { label: "To / from" }, { label: "Message" }, { label: "Status" }]} empty="No messages yet.">
          {rows.map((m) => (
            <tr key={m.id}>
              <Td className="text-xs">{fmtDateTime(m.createdAt)}</Td>
              <Td className="text-xs">{m.channel}{m.inbound ? " · in" : ""}</Td>
              <Td className="font-mono text-xs">{mask(m.to)}</Td>
              <Td className="max-w-md truncate text-xs">{m.body}</Td>
              <Td className="text-xs">{m.status.toLowerCase()}{m.error ? ` — ${m.error}` : ""}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
