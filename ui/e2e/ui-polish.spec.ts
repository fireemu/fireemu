import { expect, test } from "@playwright/test";
import { api, gotoApp, resetSession } from "./helpers";
import { PORTS } from "./global-setup";

const DOCS = "firestore/v1/projects/demo-app/databases/(default)/documents";

test.describe("Navigation and appearance", () => {
  test.beforeEach(async ({ request }) => {
    await resetSession(request);
  });

  test("the command palette opens with the keyboard and goes to a page without a reload", async ({
    page,
  }) => {
    await gotoApp(page, "/");
    await page.evaluate(() => {
      (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
    });
    await page.keyboard.press("Control+k");
    const input = page.getByTestId("command-palette-input");
    await expect(input).toBeFocused();
    await input.fill("func");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ui\/functions$/);
    await expect(page.getByRole("heading", { name: "Functions", exact: true })).toBeVisible();
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true,
      ),
    ).toBe(true);
  });

  test("a path typed into the palette opens that Firestore document", async ({ page, request }) => {
    await api(request, "PATCH", `${DOCS}/palette/target`, {
      fields: { value: { stringValue: "reached" } },
    });
    await gotoApp(page, "/");
    await page.getByTestId("command-palette-open").click();
    await page.getByTestId("command-palette-input").fill("palette/target");
    await expect(page.getByRole("option").first()).toHaveText(/Open palette\/target in Firestore/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/ui\/firestore\/palette\/target\?db=/);
    await expect(page.getByTestId("document-fields")).toContainText('"reached"');
  });

  test("Escape closes the palette and returns focus to the button that opened it", async ({
    page,
  }) => {
    await gotoApp(page, "/");
    const opener = page.getByTestId("command-palette-open");
    await opener.click();
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("an explicit theme survives a reload and the system choice clears it", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await gotoApp(page, "/");
    const toggle = page.getByTestId("theme-toggle");
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await expect(toggle).toHaveText("Theme: System");
    const light = await background();
    await toggle.click();
    await expect(toggle).toHaveText("Theme: Light");
    await toggle.click();
    await expect(toggle).toHaveText("Theme: Dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const dark = await background();
    expect(dark).not.toBe(light);
    await gotoApp(page, "/");
    await expect(page.getByTestId("theme-toggle")).toHaveText("Theme: Dark");
    expect(await background()).toBe(dark);
    await page.getByTestId("theme-toggle").click();
    await expect(page.getByTestId("theme-toggle")).toHaveText("Theme: System");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    expect(await background()).toBe(light);
    // With no explicit choice the stylesheet follows the OS by itself.
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await background()).toBe(dark);
  });
});

test.describe("Overview summary", () => {
  test.beforeEach(async ({ request }) => {
    await resetSession(request);
  });

  test("the tiles count what the session holds and lead to the product pages", async ({
    page,
    request,
  }) => {
    await gotoApp(page, "/");
    await expect(page.getByTestId("stat-auth-value")).toHaveText("0");
    await expect(page.getByTestId("stat-storage-value")).toHaveText("0");
    const signUp = await request.post(
      `http://127.0.0.1:${PORTS.http}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
      { data: { email: "tile@example.com", password: "secret123", returnSecureToken: true } },
    );
    expect(signUp.ok()).toBe(true);
    // The figures follow the header's poll; no reload is needed.
    await expect(page.getByTestId("stat-auth-value")).toHaveText("1", { timeout: 15_000 });
    await expect(page.getByTestId("stat-functions-value")).not.toHaveText("—");
    await page.getByTestId("stat-auth").click();
    await expect(page).toHaveURL(/\/ui\/auth$/);
    await expect(page.getByText("tile@example.com")).toBeVisible();
  });

  test("the snippet tabs switch between .env, shell, Web SDK and Admin SDK", async ({ page }) => {
    await gotoApp(page, "/");
    await expect(page.getByTestId("env-dotenv")).toContainText(
      `FIRESTORE_EMULATOR_HOST=127.0.0.1:${PORTS.firestore}`,
    );
    await page.getByTestId("env-web-tab").click();
    await expect(page.getByTestId("env-web")).toContainText(
      `connectFirestoreEmulator(getFirestore(app), "127.0.0.1", ${PORTS.firestore});`,
    );
    await expect(page.getByTestId("env-dotenv")).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("env-admin")).toContainText('projectId: "demo-app"');
    await page.getByTestId("env-shell-tab").click();
    await expect(page.getByTestId("env-shell")).toContainText(
      "export GOOGLE_CLOUD_PROJECT=demo-app",
    );
  });
});

test.describe("Firestore field tree", () => {
  test.beforeEach(async ({ request }) => {
    await resetSession(request);
  });

  test("shows nested values on demand and follows a reference within the database", async ({
    page,
    request,
  }) => {
    await api(request, "PATCH", `${DOCS}/tree/owner`, {
      fields: { name: { stringValue: "the owner" } },
    });
    await api(request, "PATCH", `${DOCS}/tree/doc`, {
      fields: {
        count: { integerValue: "3" },
        ratio: { doubleValue: 0.5 },
        profile: {
          mapValue: {
            fields: { address: { mapValue: { fields: { city: { stringValue: "Kyoto" } } } } },
          },
        },
        owner: {
          referenceValue: "projects/demo-app/databases/(default)/documents/tree/owner",
        },
        elsewhere: {
          referenceValue: "projects/demo-app/databases/other/documents/tree/owner",
        },
      },
    });
    await gotoApp(page, "/firestore/tree/doc");
    const fields = page.getByTestId("document-fields");
    await expect(fields).toContainText("number (integer)");
    await expect(fields).toContainText("number (double)");
    await expect(fields.getByText('"Kyoto"', { exact: true })).toHaveCount(0);
    await fields.getByRole("button", { name: "Expand address" }).click();
    await expect(fields.getByText('"Kyoto"', { exact: true })).toBeVisible();
    // A reference into another database is text, not a link this page could not honour.
    await expect(fields.getByRole("link")).toHaveCount(1);
    await fields.getByRole("link", { name: "tree/owner" }).click();
    await expect(page).toHaveURL(/\/ui\/firestore\/tree\/owner\?db=/);
    await expect(page.getByTestId("document-fields")).toContainText('"the owner"');
  });
});

test.describe("Registered functions search", () => {
  test("narrows the table by name and by trigger and says how many are shown", async ({ page }) => {
    await gotoApp(page, "/functions");
    await expect(page.getByTestId("function-row-echo")).toBeVisible();
    const total = await page.getByTestId("function-table").locator("tbody tr").count();
    await expect(page.getByTestId("function-search-count")).toHaveText(`${total} of ${total}`);
    await page.getByTestId("function-search").fill("schedule");
    await expect(page.getByTestId("function-row-tick")).toBeVisible();
    await expect(page.getByTestId("function-row-echo")).toBeHidden();
    await page.getByTestId("function-search").fill("echo");
    await expect(page.getByTestId("function-row-echo")).toBeVisible();
    await expect(page.getByTestId("function-row-tick")).toBeHidden();
    await expect(page.getByTestId("function-search-count")).toHaveText(`1 of ${total}`);
  });
});
