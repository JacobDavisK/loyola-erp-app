import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Examcore@2026";

async function login(page: Page, identifier: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail or employee ID").fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe.configure({ mode: "serial" });

test("rejects a wrong password with a generic message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail or employee ID").fill("setter@example.edu");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "incorrect" })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("demo role selector is not available in production", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Demo mode")).toHaveCount(0);
});

test("setter creates a question in the bank", async ({ page }) => {
  await login(page, "setter@example.edu");
  await page.goto("/question-bank/new");
  await page.getByLabel("Course").selectOption({ label: "BCS301 — Data Structures" });
  await page.getByLabel("Unit", { exact: true }).selectOption({ index: 2 });
  await page.getByLabel("Marks").fill("5");
  await page.getByLabel("Question text").fill("Explain the working of a deque and list two applications with $O(1)$ operations.");
  await expect(page.getByText("The question will appear here")).toHaveCount(0); // live preview rendered
  await page.getByRole("button", { name: "Create question" }).click();
  await expect(page).toHaveURL(/\/question-bank\/[a-z0-9]+$/);
  await expect(page.getByText("Awaiting review by the department")).toBeVisible();
});

test("setter generates, saves and submits the Data Structures paper", async ({ page }) => {
  await login(page, "EMP2101"); // employee-ID sign-in
  await page.goto("/assignments");
  await page.getByRole("link", { name: "Open builder" }).first().click();
  await expect(page).toHaveURL(/\/builder$/);
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText("Paper generation rules")).toBeVisible();
  await expect(page.getByText("Marks validation")).toBeVisible();
  await page.getByRole("button", { name: "Apply to paper" }).click();
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/Saved \d{2}:\d{2}|All changes saved/)).toBeVisible();
  await page.keyboard.press("Control+Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Submit paper for moderation")).toBeVisible();
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page).toHaveURL(/\/papers\/[a-z0-9]+$/);
  await expect(page.getByText("Version 1.0").first()).toBeVisible();
});

test("setter cannot reach administration", async ({ page }) => {
  await login(page, "setter@example.edu");
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Access restricted" })).toBeVisible();
});

test("moderator reviews and approves", async ({ page }) => {
  await login(page, "moderator@example.edu");
  await page.goto("/moderation");
  await page.getByRole("row", { name: /BCS301-NOV2026-A/ }).getByRole("link", { name: "Review" }).click();
  await page.getByRole("button", { name: "Start moderation" }).click();
  await expect(page.getByRole("button", { name: "Approve & send to scrutiny" })).toBeDisabled();
  for (const box of await page.getByRole("complementary", { name: "Validation" }).getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Approve & send to scrutiny" }).click();
  await expect(page).toHaveURL(/\/moderation$/);
});

test("scrutiny officer passes the paper", async ({ page }) => {
  await login(page, "scrutiny@example.edu");
  await page.goto("/scrutiny");
  await page.getByRole("row", { name: /BCS301-NOV2026-A/ }).getByRole("link", { name: "Scrutinise" }).click();
  await expect(page.getByText("READY FOR APPROVAL")).toBeVisible();
  await page.getByRole("button", { name: "Pass scrutiny" }).click();
  await expect(page).toHaveURL(/\/scrutiny$/);
});

test("controller approves, locks and downloads the final PDF", async ({ page }) => {
  await login(page, "controller@example.edu");
  await page.goto("/approvals");
  await page.getByRole("row", { name: /BCS301-NOV2026-A/ }).getByRole("link", { name: "Review" }).click();
  await expect(page.getByText("READY FOR FINAL APPROVAL")).toBeVisible();
  await page.getByRole("button", { name: "Approve & lock" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve & lock" }).click();
  await expect(page.getByText("PAPER LOCKED")).toBeVisible();
  await expect(page.getByText(/Version 2\.0 FINAL is now immutable/)).toBeVisible();

  const href = await page.getByRole("link", { name: "Final PDF" }).getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("audit trail records the lifecycle and verifies", async ({ page }) => {
  await login(page, "controller@example.edu");
  await page.goto("/audit?category=workflow&verify=1");
  await expect(page.getByText("Chain intact.")).toBeVisible();
  await expect(page.getByText("paper.lock").first()).toBeVisible();
});
