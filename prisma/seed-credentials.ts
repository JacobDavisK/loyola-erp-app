/**
 * Badge and micro-credential demo data. The signed verifiable credentials are created the first time a
 * student opens their wallet (the seed runs outside the server and holds no signing key).
 */
import type { SeedContext } from "./seed-erp";

export async function seedCredentials(s: SeedContext) {
  const { db } = s;
  console.log("› credentials: badges and micro-credentials");
  const day = 86_400_000;
  const by = s.users.registrar.id;
  const badge = (name: string, kind: "BADGE" | "MICRO_CREDENTIAL" | "CERTIFICATE_OF_PARTICIPATION", description: string, criteria: string, skills: string[], extra: { credits?: number; hours?: number } = {}) =>
    db.badgeClass.create({ data: { name, kind, description, criteria, skills, credits: extra.credits ?? null, hours: extra.hours ?? null, createdById: by } });
  const python = await badge("Python for Data Analysis", "MICRO_CREDENTIAL", "A stackable micro-credential in programming with Python for data analysis (pandas, visualisation).", "Complete the 30-hour module and pass the practical assessment with at least 60%.", ["Python", "pandas", "Data visualisation"], { credits: 2, hours: 30 });
  const hack = await badge("Hackathon 2026 — participant", "CERTIFICATE_OF_PARTICIPATION", "Took part in the 24-hour inter-college hackathon.", "Register, form a team and present a working prototype to the jury.", ["Teamwork", "Prototyping"], { hours: 24 });
  const tutor = await badge("Peer tutor", "BADGE", "Tutored junior students in programming for a full semester.", "At least 20 hours of documented peer tutoring with positive feedback.", ["Mentoring", "Communication"], { hours: 20 });
  const students = await db.student.findMany({ where: { status: "ACTIVE", program: { code: "BCA" } }, orderBy: { studentNo: "asc" }, take: 12, select: { id: true } });
  const demo = await db.student.findFirst({ where: { user: { email: "student@example.edu" } }, select: { id: true } });
  const list = [...new Set([...(demo ? [demo.id] : []), ...students.map((x) => x.id)])];
  for (const [i, id] of list.entries()) {
    await db.badgeAward.create({ data: { badgeId: hack.id, studentId: id, awardedById: by, awardedAt: new Date(s.now.getTime() - 40 * day), evidence: "Team project: campus bus tracker" } });
    if (i % 3 === 0) await db.badgeAward.create({ data: { badgeId: python.id, studentId: id, awardedById: by, awardedAt: new Date(s.now.getTime() - 20 * day) } });
    if (i === 1) await db.badgeAward.create({ data: { badgeId: tutor.id, studentId: id, awardedById: by, awardedAt: new Date(s.now.getTime() - 10 * day) } });
  }
}
