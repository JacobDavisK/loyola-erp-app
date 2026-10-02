/**
 * Campus-life demo data: counselling slots, clubs (NSS, coding club, cricket) with members and hours,
 * upcoming and past events, grievances at different stages, anti-ragging undertakings and a planned
 * convocation.
 */
import type { SeedContext } from "./seed-erp";

export async function seedCampusLife(s: SeedContext) {
  const { db } = s;
  console.log("› campus life: counselling, clubs, events, grievances, anti-ragging, convocation");
  const day = 86_400_000;
  const now = s.now.getTime();
  const at = (days: number, hourUtc: number) => { const d = new Date(now + days * day); d.setUTCHours(hourUtc, 0, 0, 0); return d; };

  // Counselling: slots over the next week (times in UTC; 04:30 UTC = 10:00 IST).
  const counsellor = s.users.counsellor.id;
  for (let d = 1; d <= 5; d++) for (let k = 0; k < 3; k++) {
    const start = new Date(at(d, 4).getTime() + 30 * 60_000 + k * 45 * 60_000);
    await db.counsellingSlot.create({ data: { counsellorId: counsellor, startsAt: start, endsAt: new Date(start.getTime() + 45 * 60_000), mode: k === 2 ? "ONLINE" : "IN_PERSON", location: k === 2 ? "Video link sent on booking" : "Student Wellness Centre, Room 12" } });
  }

  // Clubs and members.
  const students = await db.student.findMany({ where: { status: "ACTIVE" }, orderBy: { studentNo: "asc" }, select: { id: true, userId: true } });
  const nss = await db.club.create({ data: { name: "NSS Unit I", kind: "NSS", description: "National Service Scheme: community service, health and literacy camps. 240 hours over two years earn the NSS certificate.", coordinatorId: s.users["faculty.cs1"].id } });
  const coding = await db.club.create({ data: { name: "Coding Club", kind: "CLUB", description: "Weekly problem-solving sessions, hackathons and open-source contributions.", coordinatorId: s.users["faculty.cs2"].id } });
  const cricket = await db.club.create({ data: { name: "University Cricket Team", kind: "SPORTS", description: "Represents the university in inter-collegiate tournaments.", coordinatorId: s.users["hod.commerce"].id } });
  for (const [i, st] of students.entries()) {
    if (i % 3 === 0) await db.clubMember.create({ data: { clubId: nss.id, studentId: st.id, hours: 20 + (i % 7) * 10 } });
    if (i % 4 === 1) await db.clubMember.create({ data: { clubId: coding.id, studentId: st.id } });
    if (i % 9 === 2) await db.clubMember.create({ data: { clubId: cricket.id, studentId: st.id } });
  }

  // Events: an upcoming hackathon with its participation badge, an NSS drive tomorrow, and a past seminar.
  const hackBadge = await db.badgeClass.findFirst({ where: { name: { contains: "Hackathon" } } });
  const hack = await db.campusEvent.create({ data: { title: "Code for Campus — 24-hour hackathon", description: "Build something useful for the campus in 24 hours. Teams of up to four. Food and mentors provided.", clubId: coding.id, venue: "Computer Centre, Block B", startsAt: at(12, 3), endsAt: at(13, 3), capacity: 80, registrationCloses: at(10, 12), badgeId: hackBadge?.id ?? null, status: "PUBLISHED", createdById: s.users["faculty.cs2"].id } });
  const drive = await db.campusEvent.create({ data: { title: "NSS: village cleanliness and health camp", description: "Cleanliness drive and free health check-up camp at Kovalam village. Transport from the main gate at 7:30.", clubId: nss.id, venue: "Kovalam village", startsAt: at(1, 2), endsAt: at(1, 10), hours: 8, status: "PUBLISHED", createdById: s.users["faculty.cs1"].id } });
  const seminar = await db.campusEvent.create({ data: { title: "Seminar: careers in data science", description: "Talk by industry speakers on careers in data science, followed by Q&A.", venue: "Main Auditorium", startsAt: at(-14, 8), endsAt: at(-14, 10), status: "COMPLETED", createdById: s.users.welfare.id } });
  for (const st of students.slice(0, 25)) if (st.userId) await db.eventRegistration.create({ data: { eventId: hack.id, userId: st.userId, studentId: st.id } });
  for (const st of students.filter((_, i) => i % 3 === 0).slice(0, 15)) if (st.userId) await db.eventRegistration.create({ data: { eventId: drive.id, userId: st.userId, studentId: st.id } });
  for (const st of students.slice(5, 45)) if (st.userId) await db.eventRegistration.create({ data: { eventId: seminar.id, userId: st.userId, studentId: st.id, attendedAt: at(-14, 8) } });

  // Grievances.
  const year = await db.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
  const demo = await db.student.findFirst({ where: { user: { email: "student@example.edu" } }, select: { id: true, userId: true, departmentId: true } });
  const other = await db.student.findFirst({ where: { status: "ACTIVE", userId: { not: null }, id: { not: demo?.id } }, select: { id: true, userId: true, departmentId: true } });
  if (demo?.userId) {
    const g = await db.grievance.create({ data: { number: "GR/2026/00001", raisedById: demo.userId, studentId: demo.id, category: "EXAMINATION", subject: "Internal test marks not updated", description: "My internal test 1 marks for BCS301 show as absent although I wrote the test on the scheduled day. My answer sheet was returned to me with 16/20.", departmentId: demo.departmentId, level: "DEPARTMENT", status: "UNDER_REVIEW", dueAt: new Date(now + 9 * day), createdAt: new Date(now - 6 * day) } });
    await db.grievanceAction.createMany({ data: [
      { grievanceId: g.id, actorId: demo.userId, action: "SUBMITTED", note: "Sent to the department level.", createdAt: new Date(now - 6 * day) },
      { grievanceId: g.id, actorId: s.users["hod.cs"].id, action: "COMMITTEE_NOTE", note: "Asked the course teacher to check the mark sheet against the answer script.", createdAt: new Date(now - 4 * day) },
    ] });
  }
  if (other?.userId) {
    const g = await db.grievance.create({ data: { number: "GR/2026/00002", raisedById: other.userId, studentId: other.id, category: "FACILITIES", subject: "Drinking water dispenser not working in Block C", description: "The water dispenser on the second floor of Block C has not worked for two weeks.", departmentId: other.departmentId, level: "DEPARTMENT", status: "RESOLVED", resolution: "The dispenser was repaired by the estate office on 25 September and a weekly check has been added to the maintenance schedule.", resolvedAt: new Date(now - 3 * day), dueAt: new Date(now + 2 * day), createdAt: new Date(now - 13 * day) } });
    await db.grievanceAction.createMany({ data: [{ grievanceId: g.id, actorId: other.userId, action: "SUBMITTED", note: "Sent to the department level.", createdAt: new Date(now - 13 * day) }, { grievanceId: g.id, actorId: s.users["hod.cs"].id, action: "RESOLVED", note: "Repaired; weekly check scheduled.", createdAt: new Date(now - 3 * day) }] });
  }
  await db.numberSequence.upsert({ where: { key: "grievance" }, create: { key: "grievance", prefix: "GR/{YYYY}/", padding: 5, next: 3 }, update: { next: 3 } });

  // Anti-ragging undertakings: most students have filed this year's.
  let n = 0;
  for (const st of students) {
    if (++n % 5 === 0 || st.id === demo?.id) continue;
    await db.antiRaggingUndertaking.create({ data: { studentId: st.id, academicYearId: year.id, referenceNo: `ARU${year.label.slice(0, 4)}${String(100000 + n)}`, submittedAt: new Date(now - (60 - (n % 30)) * day) } });
  }

  // A planned convocation.
  await db.convocation.create({ data: { title: "Annual Convocation 2026", heldOn: at(45, 4), venue: "Main Auditorium", registrationCloses: at(30, 12), maxGuests: 2, createdById: s.users.registrar.id } });
}
