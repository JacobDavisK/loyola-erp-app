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
  ai: { enabled: true, reportAssistant: true, feedbackDrafts: true, announcementDrafts: true, dailyRequestsPerUser: 50 },
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
