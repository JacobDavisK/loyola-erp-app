import "server-only";
import { cache } from "react";
import { z } from "zod";
import { db } from "@/server/db";

const MARKS = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "ON_DUTY", "MEDICAL"] as const;

/** Typed system settings with defaults. Stored as JSON rows in SystemSetting. */
export const SETTING_SCHEMAS = {
  security: z.object({
    passwordMinLength: z.number().int().min(8).max(128),
    passwordRequireUpper: z.boolean(),
    passwordRequireLower: z.boolean(),
    passwordRequireDigit: z.boolean(),
    passwordRequireSymbol: z.boolean(),
    passwordMaxAgeDays: z.number().int().min(0).max(730),
    maxFailedLogins: z.number().int().min(3).max(20),
    lockoutMinutes: z.number().int().min(1).max(1440),
    sessionIdleMinutes: z.number().int().min(5).max(720),
    sessionAbsoluteHours: z.number().int().min(1).max(72),
    rememberDeviceDays: z.number().int().min(1).max(90),
    requireMfaForRoles: z.array(z.string()),
    signedUrlTtlSeconds: z.number().int().min(30).max(3600),
    maxFinalDownloadsPerUserPerDay: z.number().int().min(1).max(500),
    auditRetentionYears: z.number().int().min(1).max(50),
  }),
  workflow: z.object({
    allowSelfApproval: z.boolean(),
    requireMfaForApproval: z.boolean(),
    reuseCoolOffSessions: z.number().int().min(0).max(20),
    duplicateThreshold: z.number().min(0.3).max(1),
    deadlineWarningDays: z.number().int().min(1).max(30),
    moderatorsCanEditMetadata: z.boolean(),
  }),
  academic: z
    .object({
      attendanceMinimumPercent: z.number().min(0).max(100),
      attendanceCondonationPercent: z.number().min(0).max(100),
      attendancePresentMarks: z.array(z.enum(MARKS)).min(1),
      attendanceExcludedMarks: z.array(z.enum(MARKS)),
      attendanceEditWindowHours: z.number().int().min(0).max(24 * 60),
      maxCreditsPerTerm: z.number().int().min(1).max(60),
      studentNumberPrefix: z.string().max(20),
      studentNumberPadding: z.number().int().min(2).max(8),
    })
    .refine((v) => v.attendanceCondonationPercent <= v.attendanceMinimumPercent, { path: ["attendanceCondonationPercent"], message: "Condonation threshold must not exceed the minimum" })
    .refine((v) => !v.attendancePresentMarks.some((m) => v.attendanceExcludedMarks.includes(m)), { path: ["attendanceExcludedMarks"], message: "A mark cannot be both present and excluded" }),
  examination: z.object({
    hallTicketPrefix: z.string().max(20),
    examFeeRequired: z.boolean(),
    allowCondonation: z.boolean(),
    doubleValuation: z.boolean(),
    valuationMaxDifferencePercent: z.number().min(0).max(100),
    valuationMethod: z.enum(["AVERAGE", "HIGHER"]),
    revaluationWindowDays: z.number().int().min(0).max(90),
    revaluationFee: z.number().min(0),
    retotallingFee: z.number().min(0),
    revaluationMinChange: z.number().min(0).max(100),
  }),
  finance: z.object({
    invoicePrefix: z.string().max(20),
    receiptPrefix: z.string().max(20),
    examFeePerPaper: z.number().min(0),
    blockExamOnDues: z.boolean(),
  }),
  library: z.object({
    loanDaysStudent: z.number().int().min(1).max(180),
    loanDaysStaff: z.number().int().min(1).max(365),
    maxLoansStudent: z.number().int().min(1).max(50),
    maxLoansStaff: z.number().int().min(1).max(100),
    maxRenewals: z.number().int().min(0).max(10),
    finePerDay: z.number().min(0),
    fineCap: z.number().min(0),
    invoiceStudentFines: z.boolean(),
  }),
  helpdesk: z.object({
    prefix: z.string().max(20),
    categories: z.array(z.object({ key: z.string().regex(/^[a-z0-9_-]{2,30}$/), label: z.string().min(2).max(80), slaHours: z.number().int().min(1).max(720) })).min(1),
  }),
  admissions: z.object({
    applicationPrefix: z.string().max(20),
    weightQualifying: z.number().min(0).max(100),
    weightEntrance: z.number().min(0).max(100),
  }),
  placements: z.object({ oneOfferPolicy: z.boolean() }),
  ai: z.object({
    enabled: z.boolean(),
    reportAssistant: z.boolean(),
    feedbackDrafts: z.boolean(),
    announcementDrafts: z.boolean(),
    studentAssistant: z.boolean().default(true),
    dailyRequestsPerUser: z.number().int().min(1).max(1000),
  }),
  hr: z.object({
    employeePrefix: z.string().max(20),
    /** ISO weekdays (1 = Monday) that are working days for staff */
    workWeek: z.array(z.number().int().min(1).max(7)).min(1),
    /** Working days per payroll month; 0 = calendar days of the month */
    payrollWorkingDays: z.number().int().min(0).max(31),
    /** Treat days marked absent (without approved leave) as loss of pay */
    absentIsLossOfPay: z.boolean(),
    taxEnabled: z.boolean(),
    tax: z.object({
      standardDeduction: z.number().min(0),
      slabs: z.array(z.object({ upTo: z.number().positive().nullable(), rate: z.number().min(0).max(100) })).min(1),
      rebateLimit: z.number().min(0),
      rebateMax: z.number().min(0),
      cessPercent: z.number().min(0).max(100),
    }),
  }),
  obe: z.object({
    targetPercent: z.number().min(1).max(100),
    levelThresholds: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100), z.number().min(0).max(100)]).refine((t) => t[0] <= t[1] && t[1] <= t[2], { message: "Thresholds must increase" }),
    internalWeight: z.number().min(0).max(100),
    indirectWeight: z.number().min(0).max(100),
    /** Attainment (0–3) a programme outcome should reach */
    poTarget: z.number().min(0).max(3),
  }),
  nep: z.object({
    /** Highest share of programme credits that may come from SWAYAM / MOOCs / other institutions */
    externalCreditMaxPercent: z.number().min(0).max(100),
    nadIssuerName: z.string().max(200),
  }),
  success: z.object({
    weights: z.object({ attendance: z.number().min(0).max(100), marks: z.number().min(0).max(100), failures: z.number().min(0).max(100), fees: z.number().min(0).max(100), engagement: z.number().min(0).max(100) }),
    mediumAt: z.number().min(1).max(100),
    highAt: z.number().min(1).max(100),
    attendanceFloor: z.number().min(0).max(100),
    marksComfort: z.number().min(25).max(100),
    inactivityDays: z.number().int().min(1).max(90),
    /** Open a support case automatically when a student's level turns high */
    autoOpenCases: z.boolean(),
    caseSlaDays: z.number().int().min(1).max(60),
  }).refine((v) => v.mediumAt < v.highAt, { path: ["highAt"], message: "High must be above medium" }),
  timetable: z.object({
    /** ISO weekdays with classes */
    days: z.array(z.number().int().min(1).max(7)).min(1),
    /** Bell schedule: [start, end] per period, HH:MM */
    periods: z.array(z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)])).min(1).max(14),
    maxInstructorPeriodsPerDay: z.number().int().min(1).max(14),
  }),
  proctoring: z.object({
    /** Minutes between webcam frames in webcam-proctored quizzes */
    webcamIntervalMinutes: z.number().int().min(1).max(30),
    /** Integrity events above which an attempt is flagged for review */
    flagThreshold: z.number().int().min(1).max(100),
    /** Days to keep webcam frames */
    retainDays: z.number().int().min(1).max(365),
  }),
  campus: z.object({
    /** Days each grievance level has to respond (UGC: 15 days) */
    grievanceDays: z.number().int().min(1).max(60),
    ombudspersonDays: z.number().int().min(1).max(90),
    /** Days after a resolution within which the student may appeal */
    appealDays: z.number().int().min(1).max(60),
    /** Notification types also sent by SMS / WhatsApp to people who opted in */
    importantTypes: z.array(z.string().max(60)).max(50),
  }),
  operations: z.object({
    /** Room types that need approval to book (others are confirmed at once when free) */
    approvalRoomTypes: z.array(z.enum(["CLASSROOM", "LAB", "SEMINAR_HALL", "EXAM_HALL", "AUDITORIUM", "OTHER"])),
    assetTagPrefix: z.string().max(20),
  }),
  video: z.object({
    enabledTypes: z.array(z.string().max(40)).max(30),
    defaultDurationMinutes: z.number().int().min(10).max(480),
    maxDurationMinutes: z.number().int().min(15).max(720),
    maxParticipants: z.number().int().min(2).max(1000),
    /** Join from this many minutes before the scheduled start */
    joinEarlyMinutes: z.number().int().min(0).max(60),
    recordingEnabled: z.boolean(),
    recordingRetentionDays: z.number().int().min(1).max(3650),
    recordingAccessDefault: z.enum(["HOST_ONLY", "PARTICIPANTS", "COURSE", "DEPARTMENT", "ADMINS"]),
    allowRecordingDownload: z.boolean(),
    lobbyDefault: z.boolean(),
    chatDefault: z.boolean(),
    screenShareDefault: z.boolean(),
    /** Attendance: PRESENT at or above this share of the meeting */
    attendancePresentPercent: z.number().min(1).max(100),
    /** Attendance: PARTIALLY_PRESENT from this many minutes (below the threshold) */
    attendancePartialMinMinutes: z.number().int().min(0).max(120),
    guestAccessEnabled: z.boolean(),
    /** Guest links stop working this many hours after the meeting's scheduled end */
    guestGraceHours: z.number().int().min(0).max(72),
    chatRetentionDays: z.number().int().min(1).max(3650),
    reminderMinutes: z.number().int().min(0).max(120),
  }),
  privacy: z.object({
    /** Days to respond to a data-principal request */
    requestDays: z.number().int().min(1).max(90),
    /** Hours within which a personal-data breach must be reported to the Data Protection Board */
    breachNotifyHours: z.number().int().min(1).max(720),
    dpoName: z.string().max(120),
    dpoEmail: z.string().max(200),
    adultAge: z.number().int().min(16).max(21),
  }),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  security: {
    passwordMinLength: 12,
    passwordRequireUpper: true,
    passwordRequireLower: true,
    passwordRequireDigit: true,
    passwordRequireSymbol: false,
    passwordMaxAgeDays: 180,
    maxFailedLogins: 5,
    lockoutMinutes: 15,
    sessionIdleMinutes: 60,
    sessionAbsoluteHours: 12,
    rememberDeviceDays: 14,
    requireMfaForRoles: [],
    signedUrlTtlSeconds: 120,
    maxFinalDownloadsPerUserPerDay: 50,
    auditRetentionYears: 10,
  },
  workflow: {
    allowSelfApproval: false,
    requireMfaForApproval: false,
    reuseCoolOffSessions: 2,
    duplicateThreshold: 0.6,
    deadlineWarningDays: 3,
    moderatorsCanEditMetadata: false,
  },
  academic: {
    attendanceMinimumPercent: 75,
    attendanceCondonationPercent: 65,
    attendancePresentMarks: ["PRESENT", "LATE", "ON_DUTY"],
    attendanceExcludedMarks: ["EXCUSED", "MEDICAL"],
    attendanceEditWindowHours: 72,
    maxCreditsPerTerm: 30,
    studentNumberPrefix: "{YY}{PROGRAM}",
    studentNumberPadding: 4,
  },
  finance: {
    invoicePrefix: "INV/{YYYY}/",
    receiptPrefix: "RCPT/{YYYY}/",
    examFeePerPaper: 300,
    blockExamOnDues: false,
  },
  library: { loanDaysStudent: 14, loanDaysStaff: 30, maxLoansStudent: 3, maxLoansStaff: 10, maxRenewals: 2, finePerDay: 2, fineCap: 200, invoiceStudentFines: true },
  helpdesk: {
    prefix: "TKT-{YY}-",
    categories: [
      { key: "it", label: "IT, e-mail and accounts", slaHours: 24 },
      { key: "academic", label: "Academic records and timetable", slaHours: 72 },
      { key: "exam", label: "Examinations and results", slaHours: 72 },
      { key: "fees", label: "Fees and payments", slaHours: 48 },
      { key: "hostel", label: "Hostel and transport", slaHours: 48 },
      { key: "facilities", label: "Facilities and maintenance", slaHours: 96 },
    ],
  },
  admissions: { applicationPrefix: "APP{YY}-", weightQualifying: 60, weightEntrance: 40 },
  placements: { oneOfferPolicy: true },
  ai: { enabled: true, reportAssistant: true, feedbackDrafts: true, announcementDrafts: true, studentAssistant: true, dailyRequestsPerUser: 50 },
  hr: {
    employeePrefix: "EMP{YY}",
    workWeek: [1, 2, 3, 4, 5, 6],
    payrollWorkingDays: 0,
    absentIsLossOfPay: true,
    // Illustrative slab regime; the institution must maintain these to match current law.
    taxEnabled: true,
    tax: {
      standardDeduction: 75000,
      slabs: [{ upTo: 400000, rate: 0 }, { upTo: 800000, rate: 5 }, { upTo: 1200000, rate: 10 }, { upTo: 1600000, rate: 15 }, { upTo: 2000000, rate: 20 }, { upTo: 2400000, rate: 25 }, { upTo: null, rate: 30 }],
      rebateLimit: 1200000,
      rebateMax: 60000,
      cessPercent: 4,
    },
  },
  examination: {
    hallTicketPrefix: "HT{YY}-",
    examFeeRequired: false,
    allowCondonation: true,
    doubleValuation: true,
    valuationMaxDifferencePercent: 15,
    valuationMethod: "AVERAGE",
    revaluationWindowDays: 15,
    revaluationFee: 500,
    retotallingFee: 200,
    revaluationMinChange: 2,
  },
  obe: { targetPercent: 60, levelThresholds: [40, 55, 70], internalWeight: 40, indirectWeight: 20, poTarget: 2 },
  nep: { externalCreditMaxPercent: 40, nadIssuerName: "" },
  success: { weights: { attendance: 30, marks: 30, failures: 20, fees: 10, engagement: 10 }, mediumAt: 35, highAt: 60, attendanceFloor: 75, marksComfort: 60, inactivityDays: 14, autoOpenCases: true, caseSlaDays: 7 },
  timetable: { days: [1, 2, 3, 4, 5, 6], periods: [["09:00", "09:50"], ["09:50", "10:40"], ["11:00", "11:50"], ["11:50", "12:40"], ["13:30", "14:20"], ["14:20", "15:10"], ["15:10", "16:00"]], maxInstructorPeriodsPerDay: 5 },
  proctoring: { webcamIntervalMinutes: 3, flagThreshold: 5, retainDays: 90 },
  campus: { grievanceDays: 15, ombudspersonDays: 30, appealDays: 15, importantTypes: ["invoice.issued", "payment.received", "result.published", "revaluation.completed", "library.due", "placement.update", "counselling.booked", "grievance.update", "event.reminder", "convocation.update"] },
  operations: { approvalRoomTypes: ["SEMINAR_HALL", "AUDITORIUM", "EXAM_HALL"], assetTagPrefix: "AST/{YYYY}/" },
  video: {
    enabledTypes: ["ONLINE_CLASS", "FACULTY_MEETING", "DEPARTMENT_MEETING", "STUDENT_MENTORING", "PARENT_MEETING", "VIVA_VOCE", "PHD_REVIEW", "RESEARCH_MEETING", "WEBINAR", "GUEST_LECTURE", "WORKSHOP", "PLACEMENT_INTERVIEW", "ADMISSION_INTERVIEW", "EXAMINATION_MEETING", "ADMINISTRATIVE_MEETING", "GENERAL_MEETING"],
    defaultDurationMinutes: 60, maxDurationMinutes: 240, maxParticipants: 300, joinEarlyMinutes: 15,
    recordingEnabled: true, recordingRetentionDays: 365, recordingAccessDefault: "PARTICIPANTS", allowRecordingDownload: false,
    lobbyDefault: false, chatDefault: true, screenShareDefault: true,
    attendancePresentPercent: 75, attendancePartialMinMinutes: 5,
    guestAccessEnabled: true, guestGraceHours: 2, chatRetentionDays: 180, reminderMinutes: 10,
  },
  privacy: { requestDays: 30, breachNotifyHours: 72, dpoName: "Data Protection Officer", dpoEmail: "dpo@example.edu", adultAge: 18 },
};

async function load<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  const merged = { ...SETTING_DEFAULTS[key], ...((row?.value as object | null) ?? {}) };
  const parsed = SETTING_SCHEMAS[key].safeParse(merged);
  return (parsed.success ? parsed.data : SETTING_DEFAULTS[key]) as SettingValue<K>;
}

const cachedLoad = cache(load);

export function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  return cachedLoad(key) as Promise<SettingValue<K>>;
}

/** Attendance policy in the shape the pure attendance rules expect. */
export async function attendancePolicy() {
  const a = await getSetting("academic");
  return { minimumPercent: a.attendanceMinimumPercent, condonationPercent: a.attendanceCondonationPercent, presentMarks: a.attendancePresentMarks, excludedMarks: a.attendanceExcludedMarks };
}
