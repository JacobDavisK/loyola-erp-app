import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { allocate, applicableLines, invoiceStatus, spreadConcession } from "@/lib/domain/invoicing";
import { formatMoney, fromMinor, percentOf, toMinor } from "@/lib/domain/money";
import { checkEligibility } from "@/lib/domain/scholarship";
import { RazorpayGateway } from "@/server/payments/gateway";

describe("money", () => {
  it("converts decimals to minor units without float drift", () => {
    expect(toMinor("1234.56")).toBe(123456);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMinor("12.345")).toBe(1235);
    expect(toMinor("-5.5")).toBe(-550);
    expect(toMinor(null)).toBe(0);
    expect(fromMinor(123456)).toBe("1234.56");
    expect(fromMinor(5)).toBe("0.05");
    expect(percentOf(4500000, 25)).toBe(1125000);
    expect(formatMoney(123456)).toMatch(/1,234\.56/);
  });
});

describe("invoicing", () => {
  const lines = [
    { feeHeadId: "t", feeHeadName: "Tuition", amount: 4500000, semester: null, termType: null, dueDays: 30 },
    { feeHeadId: "d", feeHeadName: "Development", amount: 1000000, semester: 1, termType: null, dueDays: 30 },
    { feeHeadId: "l", feeHeadName: "Lab", amount: 500000, semester: null, termType: "ODD" as const, dueDays: 15 },
  ];
  it("selects lines for the student's semester and term", () => {
    expect(applicableLines(lines, 1, "ODD").map((l) => l.feeHeadId)).toEqual(["t", "d", "l"]);
    expect(applicableLines(lines, 2, "EVEN").map((l) => l.feeHeadId)).toEqual(["t"]);
  });
  it("derives invoice status from totals", () => {
    expect(invoiceStatus(1000, 0, false)).toBe("ISSUED");
    expect(invoiceStatus(1000, 400, false)).toBe("PARTIALLY_PAID");
    expect(invoiceStatus(1000, 1000, false)).toBe("PAID");
    expect(invoiceStatus(1000, 0, true)).toBe("CANCELLED");
  });
  it("allocates to the chosen invoice first, then oldest due, keeping any excess as credit", () => {
    const inv = [
      { id: "new", dueDate: new Date("2026-10-01"), balance: 500 },
      { id: "old", dueDate: new Date("2026-07-01"), balance: 300 },
    ];
    expect(allocate(600, inv)).toEqual({ allocations: [{ invoiceId: "old", amount: 300 }, { invoiceId: "new", amount: 300 }], unallocated: 0 });
    expect(allocate(600, inv, "new").allocations[0]).toEqual({ invoiceId: "new", amount: 500 });
    expect(allocate(1000, inv).unallocated).toBe(200);
  });
  it("spreads a concession across lines exactly", () => {
    const parts = spreadConcession([{ id: "a", amount: 1000, concession: 0 }, { id: "b", amount: 2000, concession: 0 }, { id: "c", amount: 1, concession: 0 }], 1001);
    expect(parts.reduce((a, p) => a + p.concession, 0)).toBe(1001);
    expect(parts.find((p) => p.id === "a")!.concession).toBeLessThanOrEqual(1000);
    expect(() => spreadConcession([{ id: "a", amount: 10, concession: 5 }], 6)).toThrow();
  });
});

describe("scholarship rules", () => {
  const facts = { cgpa: 8.2, attendancePercent: 88, declaredIncome: 240000, programCode: "BCA", category: "GEN", gender: "FEMALE", semester: 3, failures: 0, status: "ACTIVE" };
  it("passes when every configured rule holds", () => {
    expect(checkEligibility({ minCgpa: 7.5, maxFamilyIncome: 300000, programCodes: ["BCA"], noFailures: true }, facts).eligible).toBe(true);
  });
  it("reports every failing rule", () => {
    const r = checkEligibility({ minCgpa: 9, maxFamilyIncome: 100000, minAttendancePercent: 90 }, { ...facts, declaredIncome: null });
    expect(r.eligible).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.rule)).toEqual(["Minimum CGPA", "Minimum attendance", "Family income limit"]);
  });
});

describe("payment gateway (Razorpay adapter)", () => {
  const gw = new RazorpayGateway("rzp_test_key", "secret", "whsecret", (async (url: string) => {
    if (String(url).includes("/orders")) return new Response(JSON.stringify({ id: "order_1", amount: 150000, currency: "INR" }), { status: 200 });
    return new Response(JSON.stringify({ id: "pay_1", order_id: "order_1", status: "captured", amount: 150000, currency: "INR" }), { status: 200 });
  }) as typeof fetch);

  it("verifies checkout signatures with HMAC(order|payment)", () => {
    const sig = createHmac("sha256", "secret").update("order_1|pay_1").digest("hex");
    expect(gw.verifyCheckoutSignature("order_1", "pay_1", sig)).toBe(true);
    expect(gw.verifyCheckoutSignature("order_1", "pay_2", sig)).toBe(false);
  });
  it("verifies webhook signatures over the raw body", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "order_1" } } } });
    const headers = new Headers({ "x-razorpay-signature": createHmac("sha256", "whsecret").update(body).digest("hex") });
    expect(gw.parseWebhook(body, headers)).toEqual({ paymentId: "pay_1", orderId: "order_1" });
    expect(() => gw.parseWebhook(body.replace("pay_1", "pay_9"), headers)).toThrow();
    expect(gw.parseWebhook(JSON.stringify({ event: "refund.created" }), new Headers({ "x-razorpay-signature": createHmac("sha256", "whsecret").update(JSON.stringify({ event: "refund.created" })).digest("hex") }))).toBeNull();
  });
  it("creates orders and reads payment status from the API", async () => {
    expect((await gw.createOrder({ amountMinor: 150000, currency: "INR", receipt: "INV/1", notes: {} })).orderId).toBe("order_1");
    expect((await gw.fetchPayment("pay_1")).status).toBe("captured");
  });
});
