import { describe, expect, it } from "vitest";
import { loadStudentFor } from "@/server/auth/access";
import { db } from "@/server/db";
import { roster, saveAttendance, studentAttendance } from "@/server/services/attendance";
import { runNextJob } from "@/server/services/jobs";
import { selfRegister, staffRegister } from "@/server/services/offerings";
import { portalSubject } from "@/server/services/portal";
import { commitStudentImport, previewStudentImport } from "@/server/services/student-import";
import { createStudent, requestStatusChange } from "@/server/services/students";
import { addSlot } from "@/server/services/timetable";
import { decideTask } from "@/server/services/workflow";
import { as } from "./helpers";

const ids = async () => {
  const [bca, bca25, cs, com] = await Promise.all([
    db.program.findUniqueOrThrow({ where: { code: "BCA" } }),
    db.batch.findUniqueOrThrow({ where: { code: "BCA-2025" } }),
    db.department.findUniqueOrThrow({ where: { code: "CS" } }),
    db.department.findUniqueOrThrow({ where: { code: "COM" } }),
  ]);
  return { bca, bca25, cs, com };
};
const offering = (code: string) => db.courseOffering.findFirstOrThrow({ where: { course: { code }, term: { isCurrent: true } } });

describe("student records", () => {
  it("creates a student with a generated number and an audit entry", async () => {
    const { bca, bca25 } = await ids();
    const reg = await as("registrar");
    const s = await createStudent(reg, { firstName: "Test", lastName: "Learner", email: "test.learner@students.example.edu", programId: bca.id, batchId: bca25.id, admittedOn: "2025-07-01", currentSemester: 3 });
    expect(s.studentNo).toMatch(/^25BCA\d{4}$/);
    expect(s.admissionNo).toMatch(/^ADM2025-/);
    expect(await db.auditLog.count({ where: { action: "student.create", resourceId: s.id } })).toBe(1);
    expect(await db.domainEvent.count({ where: { type: "StudentAdmitted", aggregateId: s.id } })).toBe(1);
  });

  it("limits staff to their scope and refuses creation without permission", async () => {
    const { bca, bca25, cs, com } = await ids();
    const fac = await as("faculty.com1");
    await expect(createStudent(fac, { firstName: "X", lastName: "Y", email: "x.y@students.example.edu", programId: bca.id, batchId: bca25.id, admittedOn: "2025-07-01" })).rejects.toThrow(/permission/i);
    const csStudent = await db.student.findFirstOrThrow({ where: { departmentId: cs.id } });
    const comStudent = await db.student.findFirstOrThrow({ where: { departmentId: com.id } });
    await expect(loadStudentFor(fac, csStudent.id)).rejects.toThrow(/not found/i);
    await expect(loadStudentFor(fac, comStudent.id)).resolves.toBeTruthy();
    // A Dean of Science sees CS students but not Commerce ones.
    const dean = await as("dean.science");
    await expect(loadStudentFor(dean, csStudent.id)).resolves.toBeTruthy();
    await expect(loadStudentFor(dean, comStudent.id)).rejects.toThrow(/not found/i);
  });

  it("a student sees only their own record; a guardian only their ward", async () => {
    const student = await as("student");
    const parent = await as("parent");
    const me = student.subject.studentId!;
    const other = await db.student.findFirstOrThrow({ where: { id: { not: me }, departmentId: (await ids()).cs.id } });
    await expect(loadStudentFor(student, me)).resolves.toBeTruthy();
    await expect(loadStudentFor(student, other.id)).rejects.toThrow(/not found/i);
    expect(parent.subject.wardStudentIds).toEqual([me]);
    const subj = await portalSubject(parent, other.id); // an arbitrary id is ignored
    expect(subj.student.id).toBe(me);
    expect(subj.isSelf).toBe(false);
  });

  it("applies a status change only after HoD and Registrar approval", async () => {
    const hod = await as("hod.cs");
    const s = await db.student.findFirstOrThrow({ where: { batch: { code: "BCA-2024" }, status: "ACTIVE" } });
    const inst = await requestStatusChange(hod, s.id, { to: "ON_LEAVE", reason: "Medical leave for one semester, certificate on file.", effectiveOn: "2026-10-01" });
    // The HoD raised it, so the HoD step is skipped (no self-approval) and it waits for the Registrar.
    const tasks = await db.workflowTask.findMany({ where: { instanceId: inst.id, status: "PENDING" }, include: { assignee: true } });
    expect(tasks.map((t) => t.assignee.email)).toEqual(["registrar@example.edu"]);
    expect((await db.student.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("ACTIVE");
    await decideTask(await as("registrar"), tasks[0].id, { decision: "approve" });
    expect((await db.student.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("ON_LEAVE");
    const hist = await db.studentStatusChange.findFirstOrThrow({ where: { studentId: s.id } });
    expect(hist.workflowInstanceId).toBe(inst.id);
    await expect(db.studentStatusChange.delete({ where: { id: hist.id } })).rejects.toThrow();
  });
});

describe("registration", () => {
  it("self-registration enforces prerequisites and duplicate rules", async () => {
    const student = await as("student"); // BCA-2025: completed BCS101, not BCS303
    const bcs501 = await offering("BCS501");
    await expect(selfRegister(student, bcs501.id)).rejects.toThrow(/Prerequisite not completed: BCS303|reserved for another batch/);
    const bcs301 = await offering("BCS301");
    await expect(selfRegister(student, bcs301.id)).rejects.toThrow(/already registered/i);
  });

  it("staff can override soft rules with a reason, never hard rules", async () => {
    const hod = await as("hod.cs");
    const s = await db.student.findFirstOrThrow({ where: { batch: { code: "BCA-2026" }, status: "ACTIVE" } });
    const bcs502 = await offering("BCS502");
    const refused = await staffRegister(hod, bcs502.id, { studentIds: [s.id] });
    expect(refused[0].ok).toBe(false);
    const noReason = await staffRegister(hod, bcs502.id, { studentIds: [s.id], override: true });
    expect(noReason[0].error).toMatch(/reason/i);
    const ok = await staffRegister(hod, bcs502.id, { studentIds: [s.id], override: true, reason: "Lateral entry; approved by the Board of Studies." });
    expect(ok[0].ok).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "registration.create", resourceId: s.id }, orderBy: { id: "desc" } });
    expect((audit.newValue as { overridden: string[] }).overridden.length).toBeGreaterThan(0);
  });

  it("refuses to double-book a room", async () => {
    const reg = await as("registrar");
    const bcs304 = await offering("BCS304");
    const ab101 = await db.room.findUniqueOrThrow({ where: { code: "AB-101" } });
    await expect(addSlot(reg, bcs304.id, { dayOfWeek: 1, startTime: "09:30", endTime: "10:30", roomId: ab101.id })).rejects.toThrow(/Room already booked/);
  });
});

describe("attendance", () => {
  it("only the instructor records attendance and later edits become audited corrections", async () => {
    const bcs301 = await offering("BCS301");
    const past = await db.classMeeting.findFirstOrThrow({ where: { offeringId: bcs301.id, status: "HELD" }, orderBy: { startsAt: "desc" } });
    const teacher = await as("setter");
    const r = await roster(teacher, past.id);
    expect(r.students.length).toBeGreaterThan(0);
    await expect(roster(await as("faculty.cs2"), past.id)).rejects.toThrow();

    // Force the edit window closed for this session.
    await db.classMeeting.update({ where: { id: past.id }, data: { endsAt: new Date(Date.now() - 30 * 86_400_000), startsAt: new Date(Date.now() - 30 * 86_400_000 - 3_600_000) } });
    const first = r.students[0];
    const flip = first.mark === "ABSENT" ? "PRESENT" : "ABSENT";
    await expect(saveAttendance(teacher, past.id, { marks: [{ studentId: first.id, mark: flip }] })).rejects.toThrow(/edit window closed/i);
    const hod = await as("hod.cs");
    await saveAttendance(hod, past.id, { marks: [{ studentId: first.id, mark: flip }] });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "attendance.correct", resourceId: past.id } });
    expect(log.oldValue).toEqual([{ student: first.studentNo, mark: first.mark }]);
  });

  it("summarises a student's attendance against the configured policy", async () => {
    const student = await as("student");
    const term = await db.academicTerm.findFirstOrThrow({ where: { isCurrent: true } });
    const a = await studentAttendance(student, student.subject.studentId!, term.id);
    expect(a.classes.length).toBeGreaterThanOrEqual(5);
    expect(a.overallPercent).toBeGreaterThan(50);
    expect(a.policy.minimumPercent).toBe(75);
  });
});

describe("bulk import", () => {
  const header = "first_name,last_name,email,program_code,batch_code,admitted_on,section,guardian_name,guardian_relation\n";
  it("validates every row and refuses a file with errors", async () => {
    const reg = await as("registrar");
    const csv = header + "Asha,Kumar,asha.k@students.example.edu,BCA,BCA-2026,2026-07-01,A,Ravi Kumar,FATHER\nBad,Row,not-an-email,XYZ,BCA-2026,2026-07-01,A,,\nDup,One,asha.k@students.example.edu,BCA,BCA-2026,2026-07-01,A,,\n";
    const p = await previewStudentImport(reg, csv);
    expect(p.valid).toBe(1);
    expect(p.rows[1].errors.join(" ")).toMatch(/Unknown programme/);
    expect(p.rows[2].errors.join(" ")).toMatch(/Duplicate e-mail/);
    await expect(commitStudentImport(reg, csv, "bad.csv")).rejects.toThrow(/nothing was imported/);
  });

  it("imports a clean file in one transaction via the job queue", async () => {
    const reg = await as("registrar");
    const before = await db.student.count();
    const csv = header + "Leela,Nair,leela.nair@students.example.edu,BCA,BCA-2026,2026-07-01,A,Quentin Testguardian,FATHER\nJoel,Thomas,joel.thomas@students.example.edu,BCA,BCA-2026,2026-07-01,A,,\n";
    const job = await commitStudentImport(reg, csv, "clean.csv");
    await db.job.updateMany({ where: { status: "QUEUED", id: { not: job.id } }, data: { runAt: new Date(Date.now() + 3_600_000) } });
    expect(await runNextJob()).toBe(true);
    const row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("SUCCEEDED");
    expect(await db.student.count()).toBe(before + 2);
    expect(await db.guardian.count({ where: { name: "Quentin Testguardian" } })).toBe(1);
  });

  it("rolls back the whole file when any row fails at commit time", async () => {
    const reg = await as("registrar");
    const before = await db.student.count();
    const csv = header + "Tara,Rao,tara.rao@students.example.edu,BCA,BCA-2026,2026-07-01,A,,\nZara,Khan,zara.khan@students.example.edu,BCA,BCA-2026,2026-07-01,A,,\n";
    const job = await commitStudentImport(reg, csv, "race.csv");
    // Simulate a concurrent change after validation: the second row's admission number is taken.
    const payload = job.payload as { rows: { input: { admissionNo?: string | null } }[] };
    payload.rows[1].input.admissionNo = (await db.student.findFirstOrThrow()).admissionNo;
    await db.job.update({ where: { id: job.id }, data: { payload } });
    await runNextJob();
    const row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("FAILED");
    expect(row.error).toMatch(/Line 3: .*rolled back/);
    expect(await db.student.count()).toBe(before);
  });
});
