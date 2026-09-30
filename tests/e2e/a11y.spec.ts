import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Automated WCAG 2.1 A/AA checks (axe-core) on representative pages for each kind of user. The suite fails on
 * serious and critical violations; moderate/minor ones are printed for triage. Automated checks catch roughly a
 * third of accessibility problems — keyboard and screen-reader passes remain part of release testing.
 */

const PASSWORD = "Examcore@2026";

async function login(page: Page, identifier: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail or employee ID").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(dashboard|portal)/);
}

async function audit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  console.log(`[a11y] ${path}: ${r.passes.length} rules passed, ${r.violations.length} violation(s), ${r.incomplete.length} need review`);
  const blocking = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  for (const v of r.violations) console.log(`[a11y] ${path} ${v.impact} ${v.id}: ${v.nodes.length} node(s) — ${v.nodes[0]?.target.join(" ")}`);
  expect(blocking.map((v) => `${v.id} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")})`), `${path}`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test("public pages", async ({ page }) => {
  for (const p of ["/login", "/apply", "/verify"]) await audit(page, p);
});

test("student pages", async ({ page }) => {
  await login(page, "student@example.edu");
  for (const p of ["/portal", "/portal/courses", "/portal/fees", "/portal/results", "/portal/services", "/library", "/helpdesk"]) await audit(page, p);
});

test("staff pages", async ({ page }) => {
  await login(page, "registrar@example.edu");
  for (const p of ["/dashboard", "/students", "/inbox", "/insights", "/reports/builder", "/admissions", "/announcements", "/research"]) await audit(page, p);
});

test("HR and finance pages", async ({ page }) => {
  await login(page, "hr@example.edu");
  for (const p of ["/hr/employees", "/hr/payroll", "/me/leave"]) await audit(page, p);
  await login(page, "finance@example.edu");
  for (const p of ["/finance", "/finance/invoices"]) await audit(page, p);
});
