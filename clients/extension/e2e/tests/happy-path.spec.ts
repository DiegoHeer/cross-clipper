import { expect, test } from "../fixtures";

test("onboard → send → receive live → copy → filter", async ({ page, popupUrl, server }) => {
  await page.goto(popupUrl);

  // --- Onboarding: fresh server ⇒ step 2 is account creation
  await page.getByPlaceholder(/clip.example.com/).fill(server.baseUrl);
  await page.getByRole("button", { name: /next/i }).click();
  // Step 1→2 transition: React batches setFound + onNext, so the transient
  // "✓ CrossClipper v…" text is never rendered; assert step 2 instead.
  await expect(page.getByText(/create your account/i)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel(/email/i).fill("owner@example.com");
  await page.getByLabel(/password/i).fill("password123!");
  await page.getByLabel(/device name/i).fill("E2E Chrome");
  await page.getByRole("button", { name: /create account/i }).click();

  // Step 3 (appearance) may render briefly before the worker's auth-state update
  // switches the App to the live feed. Handle both races: if appearance is shown,
  // click through; otherwise the feed already loaded.
  const appearanceHeading = page.getByText(/appearance/i);
  const emptyFeedHint = page.getByText(/copy something on another device/i);
  await Promise.race([
    appearanceHeading.waitFor({ state: "visible" }),
    emptyFeedHint.waitFor({ state: "visible" }),
  ]);
  if (await appearanceHeading.isVisible()) {
    await page.getByRole("button", { name: /start using crossclipper/i }).click();
  }

  // --- Empty feed hint, then send
  await expect(emptyFeedHint).toBeVisible({ timeout: 10_000 });
  await page.getByRole("textbox").fill("hello from e2e");
  await page.getByRole("textbox").press("Enter");
  await expect(page.getByText("hello from e2e")).toBeVisible();

  // --- Second device posts via the raw API (login registers the device)
  const login = await (
    await fetch(`${server.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.com",
        password: "password123!",
        device_name: "Fake phone",
        platform: "android",
      }),
    })
  ).json();
  await fetch(`${server.baseUrl}/api/v1/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${login.token}`,
    },
    body: JSON.stringify({ kind: "text", body: "from the phone" }),
  });

  // --- Arrives live over WS (no reload)
  await expect(page.getByText("from the phone")).toBeVisible({ timeout: 10_000 });

  // --- Copy shows confirmation
  const phoneCard = page.locator("article", { hasText: "from the phone" });
  await phoneCard.getByRole("button", { name: /copy/i }).click();
  await expect(phoneCard.getByText(/copied ✓/i)).toBeVisible();

  // --- Rail filter: click device in the nav rail (not the compose target picker)
  await page.getByRole("navigation", { name: /devices/i }).getByRole("button", { name: /fake phone/i }).click();
  await expect(page.getByText("from the phone")).toBeVisible();
  await expect(page.getByText("hello from e2e")).toBeHidden();
});
