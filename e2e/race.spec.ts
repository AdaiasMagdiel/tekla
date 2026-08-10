import { test, expect, type Page } from "@playwright/test";

async function signUp(page: Page, username: string, displayName: string) {
  await page.goto("/");
  await page.locator("#registerTabBtn").click();
  await page.locator("#username").fill(username);
  await page.locator("#displayName").fill(displayName);
  await page.locator("#password").fill("testpassword123");
  await page.locator("#authSubmitBtn").click();
  await expect(page.locator("#appPanel")).toBeVisible();
}

test("two players race end-to-end: create room, join, race, see results", async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await signUp(host, `host_${Date.now()}`, "Host Player");
  await host.locator("#createBtn").click();
  await host.waitForURL(/\/room\//);
  const code = (await host.locator("#roomCodeLabel").textContent())?.trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  await signUp(guest, `guest_${Date.now()}`, "Guest Player");
  await guest.locator("#roomCode").fill(code!);
  await guest.locator("#joinBtn").click();
  await guest.waitForURL(/\/room\//);

  // Guest shows up in the host's track before the race starts.
  await expect(host.locator("#track")).toContainText("Guest Player");

  await host.locator("#startBtn").click();

  // Countdown runs ~5s; the race text becomes readable (unblurred) once it goes.
  await expect(host.locator("#typingInput")).toBeEnabled({ timeout: 10_000 });
  await expect(guest.locator("#typingInput")).toBeEnabled({ timeout: 10_000 });

  const target = (await host.locator("#textChars").innerText()).trim();
  expect(target.length).toBeGreaterThan(0);

  // Host finishes first, guest second — checks both the winner and runner-up paths.
  await host.locator("#typingInput").fill(target);
  await guest.locator("#typingInput").fill(target);

  await expect(host.locator("#resultsArea")).toBeVisible({ timeout: 10_000 });
  await expect(guest.locator("#resultsArea")).toBeVisible({ timeout: 10_000 });
  await expect(host.locator("#resultsList")).toContainText("Host Player");
  await expect(host.locator("#resultsList")).toContainText("Guest Player");

  await hostCtx.close();
  await guestCtx.close();
});
