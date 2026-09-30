import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Examcore@2026";

async function login(page: Page, identifier: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail or employee ID").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(dashboard|portal)/);
}

/** A working weekday about three weeks ahead (Mon–Fri), as YYYY-MM-DD. */
function futureWeekday(offsetDays = 21) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test.describe.configure({ mode: "serial" });

test("staff member applies for leave and the reporting manager approves it", async ({ page }) => {
  const day = futureWeekday();
  await login(page, "faculty.cs1@example.edu");
  await page.goto("/me/leave");
  await page.getByRole("button", { name: "Apply for leave" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("From").fill(day);
  await dialog.getByLabel("To").fill(day);
  await dialog.getByLabel("Reason").fill("Attending a university workshop");
  await dialog.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByRole("cell", { name: "Attending a university workshop" })).toBeVisible();
  await expect(page.getByText("Awaiting approval").first()).toBeVisible();

  await login(page, "hod.cs@example.edu");
  await page.goto("/inbox");
  await page.getByRole("link", { name: /Casual leave: Anita George/ }).first().click();
  await page.getByRole("button", { name: "Approve" }).first().click();
  const confirm = page.getByRole("dialog");
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /Approve/ }).click();
  await expect(page.getByText(/approved/i).first()).toBeVisible();

  await login(page, "faculty.cs1@example.edu");
  await page.goto("/me/leave");
  await expect(page.getByRole("row", { name: /Attending a university workshop/ }).getByText("Approved")).toBeVisible();
});

test("student takes a timed quiz and sees the review", async ({ page }) => {
  await login(page, "student@example.edu");
  await page.goto("/portal/courses");
  await page.getByRole("link", { name: /BCS301-A/ }).click();
  await page.getByRole("link", { name: "Quizzes" }).click();
  await page.getByRole("link", { name: "Quiz 1: asymptotics" }).click();
  const start = page.getByRole("button", { name: /Start (quiz|another attempt)/ });
  await start.click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByLabel("O(n²)").check();
  await page.getByLabel("True").check();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText(/score \d+(\.\d+)? \/ 10/).first()).toBeVisible();
  await expect(page.getByText("Correct answer:").first()).toBeVisible();
});

test("applicant applies online without an account and gets a private status page", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/apply");
  await page.getByLabel("First name").fill("Esha");
  await page.getByLabel("Last name").fill("Kurian");
  await page.getByLabel("E-mail").fill(`esha.kurian.${Date.now()}@example.com`);
  await page.getByLabel("Phone").fill("+91 90000 33333");
  await page.getByLabel("Date of birth").fill("2008-03-21");
  await page.getByLabel("Qualifying examination").fill("ICSE Class XII");
  await page.getByLabel("Qualifying percentage").fill("91");
  await page.getByLabel(/I confirm/).check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page).toHaveURL(/\/apply\/status\?n=APP/);
  await expect(page.getByText("Your application has been submitted")).toBeVisible();
  await expect(page.getByText("Esha Kurian")).toBeVisible();
  // The status link without its token shows nothing.
  await page.goto(page.url().replace(/&t=[^&]+/, "&t=forged"));
  await expect(page.getByText("This link is incomplete or not valid")).toBeVisible();
});

test("librarian issues and receives a book at the circulation desk", async ({ page }) => {
  await login(page, "librarian@example.edu");
  await page.goto("/library");
  await page.getByLabel("Student / employee no.").fill("25BCA0003");
  await page.getByLabel("Accession no.").first().fill("ACC000009");
  await page.getByRole("button", { name: "Issue" }).click();
  await expect(page.getByText(/^Due /)).toBeVisible();
  await page.getByLabel("Accession no.").nth(1).fill("ACC000009");
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByText(/Returned — no fine/)).toBeVisible();
});

test("student raises a helpdesk ticket and an agent replies", async ({ page }) => {
  await login(page, "student@example.edu");
  await page.goto("/helpdesk");
  await page.getByRole("button", { name: "New ticket" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Subject").fill("Hall ticket shows the wrong photograph");
  await d.getByLabel("Describe the problem").fill("The photograph on my hall ticket belongs to another student.");
  await d.getByRole("button", { name: "Raise ticket" }).click();
  await expect(page.getByRole("link", { name: "Hall ticket shows the wrong photograph" })).toBeVisible();

  await login(page, "helpdesk@example.edu");
  await page.goto("/helpdesk");
  await page.getByRole("link", { name: "Hall ticket shows the wrong photograph" }).click();
  await page.getByRole("button", { name: "Take it" }).click();
  await page.getByLabel("Reply").fill("Thanks — the examination office will reissue the hall ticket today.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("the examination office will reissue")).toBeVisible();
});

test("registrar builds a summary report and exports it", async ({ page }) => {
  await login(page, "registrar@example.edu");
  await page.goto("/reports/builder");
  await page.getByLabel("Dataset").selectOption("students");
  await page.getByRole("button", { name: "Summary" }).click();
  await page.getByLabel("Group by 1").selectOption("program");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("columnheader", { name: "Programme" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "BCA" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
});

test("a student cannot open staff areas", async ({ page }) => {
  await login(page, "student@example.edu");
  for (const path of ["/hr/employees", "/finance", "/admissions", "/reports/builder?dataset=employees"]) {
    await page.goto(path);
    await expect(page).not.toHaveURL(new RegExp(`${path.split("?")[0]}$`));
  }
});
