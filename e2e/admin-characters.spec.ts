import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_IMAGE = path.join(__dirname, "fixtures", "test-character.png");

test("admin uploads a character, a player picks it, and it shows up in the room", async ({ browser }) => {
  const adminCtx = await browser.newContext({
    httpCredentials: { username: "e2e-admin", password: "e2e-password" },
  });
  const admin = await adminCtx.newPage();

  const characterName = `Foguete ${Date.now()}`;

  await admin.goto("/admin/characters.html");
  await admin.locator("#newBtn").click();
  await admin.locator("#editName").fill(characterName);
  await admin.locator("#editImage").setInputFiles(FIXTURE_IMAGE);
  await admin.locator("#saveBtn").click();

  await expect(admin.locator("#tableWrap")).toContainText(characterName);
  await adminCtx.close();

  // A fresh (unauthenticated) context picks the character on the home page.
  const player = await browser.newPage();
  await player.goto("/");
  await player.locator("#username").fill(`picker_${Date.now()}`);
  await player.locator("#displayName").fill("Picker Player");

  // Thumbnails have no visible text — the character's name is only in the title attribute.
  const option = player.locator(`.character-option[title="${characterName}"]`);
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  await expect(option).toHaveClass(/selected/);

  await player.locator("#createBtn").click();
  await player.waitForURL(/\/room\//);

  // The car on the track renders the uploaded image instead of the emoji.
  await expect(player.locator(".lane .car img")).toBeVisible();
  const src = await player.locator(".lane .car img").getAttribute("src");
  expect(src).toContain("/uploads/characters/");
});
