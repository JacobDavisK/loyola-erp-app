import "server-only";
import { db, type Tx } from "@/server/db";
import { env } from "@/server/env";
import { BRAND } from "@/lib/brand";

export interface NotifyInput {
  userIds: (string | null | undefined)[];
  type: string;
  title: string;
  body?: string;
  link?: string;
  email?: boolean;
}

/**
 * Central notification dispatcher: in-app rows + e-mail via the configured driver.
 * The "outbox" driver persists mails for a delivery worker; add an SMTP/provider adapter for production.
 * Confidentiality: messages carry pointers only — never question-paper content.
 */
export async function notify(input: NotifyInput, tx?: Tx): Promise<void> {
  const client = tx ?? db;
  const ids = [...new Set(input.userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await client.notification.createMany({
    data: ids.map((userId) => ({ userId, type: input.type, title: input.title, body: input.body, link: input.link })),
  });
  if (input.email === false) return;
  const users = await client.user.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { email: true } });
  if (env.EMAIL_DRIVER === "outbox" && users.length) {
    await client.emailOutbox.createMany({
      data: users.map((u) => ({
        to: u.email,
        subject: `${BRAND.mailTag} ${input.title}`,
        text: `${input.title}\n\n${input.body ?? ""}\n\nOpen ${BRAND.name}: ${env.APP_URL}${input.link ?? "/dashboard"}`,
      })),
    });
  }
}
